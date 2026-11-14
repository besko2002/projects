import { useCallback, useState } from 'react';
import { api } from '../api/api';
import type { OrgChartNode } from '../api/types';
import { Banner } from '../components/Banner';
import { Card, EmptyState, Loading, PageHeader } from '../components/states';
import { useResource } from '../lib/useResource';

interface NodeProps {
  node: OrgChartNode;
  /** The shape of the root level; part of the cache key of every level below it. */
  rootVersion: string;
  childrenById: Map<string, OrgChartNode[]>;
  loadingIds: Set<string>;
  errors: Map<string, string>;
  expanded: Set<string>;
  toggle: (id: string) => void;
}

/**
 * One person of the chart. A node knows how many direct reports it has; their rows are
 * fetched the first time it is expanded, so the chart never downloads the whole company.
 */
function OrgNode({
  node,
  rootVersion,
  childrenById,
  loadingIds,
  errors,
  expanded,
  toggle,
}: NodeProps): JSX.Element {
  const hasChildren = node.childCount > 0;
  const isExpanded = expanded.has(node.id);
  const cacheKey = `${rootVersion}:${node.id}`;
  const children = childrenById.get(cacheKey) ?? [];
  const loading = loadingIds.has(node.id);
  const error = errors.get(node.id);

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
              loadingIds={loadingIds}
              errors={errors}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartPage(): JSX.Element {
  const chart = useResource<OrgChartNode[]>((signal) => api.orgChart(signal), 'org-chart');
  // Nodes start collapsed: nothing below the root level is fetched until it is asked for.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The levels below the root are cached under a key that contains the shape of the root level,
  // so a changed root invalidates the cached levels without an effect that would reset state.
  const rootVersion = (chart.data ?? [])
    .map((node) => `${node.id}:${node.childCount}`)
    .join('|');
  const [childrenById, setChildrenById] = useState<Map<string, OrgChartNode[]>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  // Load the reports of a node the first time it is expanded.
  const loadChildren = useCallback((id: string): void => {
    setLoadingIds((current) => new Set(current).add(id));
    setErrors((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    api
      .orgChartChildren(id)
      .then((children) => {
        setChildrenById((current) => {
          const next = new Map(current);
          next.set(`${rootVersion}:${id}`, children);
          return next;
        });
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

  return (
    <>
      <PageHeader
        title="Org chart"
        subtitle="The company tree, one level at a time. Pay is never part of this view."
      />

      <Card>
        {chart.loading && <Loading label="Loading the org chart…" />}
        {chart.error !== null && <Banner>{chart.error}</Banner>}
        {chart.data !== null && chart.data.length === 0 && (
          <EmptyState title="The org chart is empty." />
        )}
        {chart.data !== null && chart.data.length > 0 && (
          <ul className="org-tree" aria-label="Organisation chart">
            {chart.data.map((node) => (
              <OrgNode
                key={node.id}
                node={node}
                rootVersion={rootVersion}
                childrenById={childrenById}
                loadingIds={loadingIds}
                errors={errors}
                expanded={expanded}
                toggle={toggle}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
