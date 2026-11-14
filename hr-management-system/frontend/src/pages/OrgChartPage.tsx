import { useCallback, useMemo, useState } from 'react';
import { api } from '../api/api';
import type { OrgChartNode, PageResponse } from '../api/types';
import { Banner } from '../components/Banner';
import { Card, EmptyState, Loading, PageHeader } from '../components/states';
import { useResource } from '../lib/useResource';

interface ChildPaging {
  page: number;
  totalPages: number;
  totalElements: number;
}

interface NodeProps {
  node: OrgChartNode;
  /** The shape of the root level; part of the cache key of every level below it. */
  rootVersion: string;
  childrenById: Map<string, OrgChartNode[]>;
  childPagingById: Map<string, ChildPaging>;
  loadingIds: Set<string>;
  loadingMoreChildIds: Set<string>;
  errors: Map<string, string>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  loadMoreChildren: (id: string) => void;
}

/**
 * One person of the chart. A node knows how many direct reports it has; their rows are
 * fetched the first time it is expanded, with bounded pagination continuation so the
 * payload stays small even for large teams.
 */
function OrgNode({
  node,
  rootVersion,
  childrenById,
  childPagingById,
  loadingIds,
  loadingMoreChildIds,
  errors,
  expanded,
  toggle,
  loadMoreChildren,
}: NodeProps): JSX.Element {
  const hasChildren = node.childCount > 0;
  const isExpanded = expanded.has(node.id);
  const cacheKey = `${rootVersion}:${node.id}`;
  const children = childrenById.get(cacheKey) ?? [];
  const paging = childPagingById.get(cacheKey);
  const loading = loadingIds.has(node.id);
  const loadingMore = loadingMoreChildIds.has(node.id);
  const error = errors.get(node.id);
  const totalReports = paging?.totalElements ?? node.childCount;
  const hasMoreChildren = paging ? paging.page + 1 < paging.totalPages : children.length < node.childCount;

  return (
    <li className="org-node">
      <div className="org-person">
        {hasChildren ? (
          <button
            type="button"
            className="org-toggle"
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Collapse the reports of ${node.fullName}`
                : `Expand the reports of ${node.fullName}`
            }
            onClick={() => {
              toggle(node.id);
            }}
          >
            {isExpanded ? '−' : '+'}
          </button>
        ) : (
          <span className="org-toggle org-toggle-leaf" aria-hidden="true" />
        )}
        <span className="org-name">{node.fullName}</span>
        <span className="org-meta">
          {node.jobTitle ?? 'No job title'}
          {node.departmentName === null ? '' : ` · ${node.departmentName}`}
        </span>
        {hasChildren && (
          <span className="org-count">
            {node.childCount} direct report{node.childCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul className="org-children">
          {loading && <li className="org-node org-children-loading">Loading the reports…</li>}
          {error !== undefined && <li className="org-node org-children-error">{error}</li>}
          {children.map((child) => (
            <OrgNode
              key={child.id}
              node={child}
              rootVersion={rootVersion}
              childrenById={childrenById}
              childPagingById={childPagingById}
              loadingIds={loadingIds}
              loadingMoreChildIds={loadingMoreChildIds}
              errors={errors}
              expanded={expanded}
              toggle={toggle}
              loadMoreChildren={loadMoreChildren}
            />
          ))}
          {loadingMore && <li className="org-node org-children-loading">Loading more reports…</li>}
          {!loading && !loadingMore && hasMoreChildren && (
            <li className="org-node org-continuation">
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  loadMoreChildren(node.id);
                }}
              >
                Load more reports ({children.length} of {totalReports})
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function extractNodes(data: PageResponse<OrgChartNode> | OrgChartNode[] | null): OrgChartNode[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.content ?? [];
}

export function OrgChartPage(): JSX.Element {
  const chart = useResource<PageResponse<OrgChartNode> | OrgChartNode[]>(
    (signal) => api.orgChart(undefined, undefined, signal),
    'org-chart',
  );

  const initialRoots = useMemo(() => extractNodes(chart.data), [chart.data]);
  const initialVersion = useMemo(
    () => initialRoots.map((node) => `${node.id}:${node.childCount}`).join('|'),
    [initialRoots],
  );

  const [extraRootsByVersion, setExtraRootsByVersion] = useState<Map<string, OrgChartNode[]>>(
    new Map(),
  );
  const [rootPageByVersion, setRootPageByVersion] = useState<Map<string, number>>(new Map());
  const [rootPagingByVersion, setRootPagingByVersion] = useState<
    Map<string, { totalPages: number; totalElements: number }>
  >(new Map());
  const [loadingMoreRoots, setLoadingMoreRoots] = useState(false);
  const [rootContinuationError, setRootContinuationError] = useState<string | null>(null);

  const extraRoots = useMemo(
    () => extraRootsByVersion.get(initialVersion) ?? [],
    [extraRootsByVersion, initialVersion],
  );
  const rootPage = rootPageByVersion.get(initialVersion) ?? 0;
  const rootTotalPages =
    rootPagingByVersion.get(initialVersion)?.totalPages ??
    (chart.data && !Array.isArray(chart.data) ? (chart.data.totalPages ?? 1) : 1);
  const rootTotalElements =
    rootPagingByVersion.get(initialVersion)?.totalElements ??
    (chart.data && !Array.isArray(chart.data)
      ? (chart.data.totalElements ?? initialRoots.length)
      : initialRoots.length);

  const allRoots = useMemo(() => [...initialRoots, ...extraRoots], [initialRoots, extraRoots]);

  // Nodes start collapsed: nothing below the root level is fetched until it is asked for.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The levels below the root are cached under a key that contains the shape of the root level,
  // so a changed root invalidates the cached levels without an effect that would reset state.
  const rootVersion = allRoots
    .map((node) => `${node.id}:${node.childCount}`)
    .join('|');
  const [childrenById, setChildrenById] = useState<Map<string, OrgChartNode[]>>(new Map());
  const [childPagingById, setChildPagingById] = useState<Map<string, ChildPaging>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [loadingMoreChildIds, setLoadingMoreChildIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  // Load the reports of a node the first time it is expanded (page 0).
  const loadChildren = useCallback((id: string): void => {
    setLoadingIds((current) => new Set(current).add(id));
    setErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    api
      .orgChartChildren(id, 0, 50)
      .then((res) => {
        const nodes = extractNodes(res);
        setChildrenById((current) => {
          const next = new Map(current);
          next.set(`${rootVersion}:${id}`, nodes);
          return next;
        });
        if (!Array.isArray(res)) {
          setChildPagingById((current) => {
            const next = new Map(current);
            next.set(`${rootVersion}:${id}`, {
              page: res.page,
              totalPages: res.totalPages,
              totalElements: res.totalElements,
            });
            return next;
          });
        }
      })
      .catch((cause: unknown) => {
        setErrors((current) => {
          const next = new Map(current);
          next.set(id, cause instanceof Error ? cause.message : 'Could not load the reports');
          return next;
        });
      })
      .finally(() => {
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      });
  }, [rootVersion]);

  // Load subsequent page of reports for a node.
  const loadMoreChildren = useCallback((id: string): void => {
    const cacheKey = `${rootVersion}:${id}`;
    const currentPaging = childPagingById.get(cacheKey) ?? { page: 0, totalPages: 1, totalElements: 0 };
    const nextPage = currentPaging.page + 1;
    setLoadingMoreChildIds((current) => new Set(current).add(id));
    setErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });

    api
      .orgChartChildren(id, nextPage, 50)
      .then((res) => {
        const nextNodes = extractNodes(res);
        setChildrenById((current) => {
          const next = new Map(current);
          const existing = next.get(cacheKey) ?? [];
          next.set(cacheKey, [...existing, ...nextNodes]);
          return next;
        });
        if (!Array.isArray(res)) {
          setChildPagingById((current) => {
            const next = new Map(current);
            next.set(cacheKey, {
              page: res.page,
              totalPages: res.totalPages,
              totalElements: res.totalElements,
            });
            return next;
          });
        }
      })
      .catch((cause: unknown) => {
        setErrors((current) => {
          const next = new Map(current);
          next.set(id, cause instanceof Error ? cause.message : 'Could not load more reports');
          return next;
        });
      })
      .finally(() => {
        setLoadingMoreChildIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      });
  }, [rootVersion, childPagingById]);

  // Load subsequent page of roots.
  const loadMoreRoots = useCallback((): void => {
    const nextPage = rootPage + 1;
    setLoadingMoreRoots(true);
    setRootContinuationError(null);
    api
      .orgChart(nextPage, 50)
      .then((res) => {
        const nextNodes = extractNodes(res);
        setExtraRootsByVersion((prev) => {
          const next = new Map(prev);
          const current = next.get(initialVersion) ?? [];
          next.set(initialVersion, [...current, ...nextNodes]);
          return next;
        });
        setRootPageByVersion((prev) => new Map(prev).set(initialVersion, nextPage));
        if (!Array.isArray(res)) {
          setRootPagingByVersion((prev) =>
            new Map(prev).set(initialVersion, {
              totalPages: res.totalPages,
              totalElements: res.totalElements,
            }),
          );
        }
      })
      .catch((cause: unknown) => {
        setRootContinuationError(
          cause instanceof Error ? cause.message : 'Could not load more roots',
        );
      })
      .finally(() => {
        setLoadingMoreRoots(false);
      });
  }, [rootPage, initialVersion]);

  function toggle(id: string): void {
    const isExpanded = expanded.has(id);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (!isExpanded && !childrenById.has(`${rootVersion}:${id}`)) {
      loadChildren(id);
    }
  }

  const hasMoreRoots = rootPage + 1 < rootTotalPages;

  return (
    <>
      <PageHeader
        title="Org chart"
        subtitle="The company tree, one level at a time. Pay is never part of this view."
      />

      <Card>
        {chart.loading && <Loading label="Loading the org chart…" />}
        {chart.error !== null && <Banner>{chart.error}</Banner>}
        {chart.data !== null && allRoots.length === 0 && (
          <EmptyState title="The org chart is empty." />
        )}
        {chart.data !== null && allRoots.length > 0 && (
          <>
            <ul className="org-tree" aria-label="Organisation chart">
              {allRoots.map((node) => (
                <OrgNode
                  key={node.id}
                  node={node}
                  rootVersion={rootVersion}
                  childrenById={childrenById}
                  childPagingById={childPagingById}
                  loadingIds={loadingIds}
                  loadingMoreChildIds={loadingMoreChildIds}
                  errors={errors}
                  expanded={expanded}
                  toggle={toggle}
                  loadMoreChildren={loadMoreChildren}
                />
              ))}
            </ul>
            {loadingMoreRoots && <p className="muted">Loading more roots…</p>}
            {rootContinuationError !== null && <Banner>{rootContinuationError}</Banner>}
            {!loadingMoreRoots && hasMoreRoots && (
              <div style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={loadMoreRoots}
                >
                  Load more roots ({allRoots.length} of {rootTotalElements})
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
