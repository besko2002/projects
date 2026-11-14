import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeOrgNode, signedIn } from '../test/fixtures';
import { installFetchMock } from '../test/fetchMock';
import { renderApp } from '../test/helpers';
import type { RouteHandler } from '../test/fetchMock';

const ROOT = makeOrgNode({ id: 'emp-9', fullName: 'Omar Said', childCount: 1 });
const NADIA = makeOrgNode({
  id: 'emp-1',
  fullName: 'Nadia Hassan',
  jobTitle: 'Analyst',
  childCount: 1,
});
const YOUSSEF = makeOrgNode({
  id: 'emp-2',
  fullName: 'Youssef Adel',
  jobTitle: null,
  departmentName: null,
  childCount: 0,
});

function orgRoutes(overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> {
  return {
    ...signedIn(),
    'GET /api/org-chart': { body: [ROOT] },
    'GET /api/org-chart/emp-9/children': { body: [NADIA] },
    'GET /api/org-chart/emp-1/children': { body: [YOUSSEF] },
    ...overrides,
  };
}

describe('org chart', () => {
  it('renders the root level only and asks for nothing else', async () => {
    const mock = installFetchMock(orgRoutes());

    renderApp('/org-chart');

    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    expect(within(tree).getByText('Omar Said')).toBeInTheDocument();
    // The reports are not loaded until the node is expanded - the whole company is never fetched.
    expect(within(tree).queryByText('Nadia Hassan')).not.toBeInTheDocument();
    expect(mock.urlsFor('GET', '/api/org-chart')).toEqual(['/api/org-chart']);
    expect(mock.urlsFor('GET', '/api/org-chart/emp-9/children')).toEqual([]);
  });

  it('counts the direct reports of a node', async () => {
    installFetchMock(orgRoutes());

    renderApp('/org-chart');

    expect(await screen.findByText('1 direct report')).toBeInTheDocument();
  });

  it('loads the reports of a node when it is expanded', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(orgRoutes());

    renderApp('/org-chart');
    await screen.findByRole('list', { name: 'Organisation chart' });
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));

    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    expect(await within(tree).findByText('Nadia Hassan')).toBeInTheDocument();
    expect(mock.urlsFor('GET', '/api/org-chart/emp-9/children')).toEqual([
      '/api/org-chart/emp-9/children',
    ]);
  });

  it('collapses a node, hiding its reports', async () => {
    const user = userEvent.setup();
    installFetchMock(orgRoutes());

    renderApp('/org-chart');
    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));
    await within(tree).findByText('Nadia Hassan');

    await user.click(screen.getByRole('button', { name: 'Collapse the reports of Omar Said' }));

    expect(within(tree).queryByText('Nadia Hassan')).not.toBeInTheDocument();
    expect(within(tree).getByText('Omar Said')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand the reports of Omar Said' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the node again without asking the server a second time', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(orgRoutes());

    renderApp('/org-chart');
    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));
    await within(tree).findByText('Nadia Hassan');
    await user.click(screen.getByRole('button', { name: 'Collapse the reports of Omar Said' }));
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));

    expect(await within(tree).findByText('Nadia Hassan')).toBeInTheDocument();
    expect(mock.urlsFor('GET', '/api/org-chart/emp-9/children')).toEqual([
      '/api/org-chart/emp-9/children',
    ]);
  });

  it('drills deeper one level at a time', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(orgRoutes());

    renderApp('/org-chart');
    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));
    await within(tree).findByText('Nadia Hassan');
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Nadia Hassan' }));

    expect(await within(tree).findByText('Youssef Adel')).toBeInTheDocument();
    expect(mock.urlsFor('GET', '/api/org-chart/emp-1/children')).toEqual([
      '/api/org-chart/emp-1/children',
    ]);
  });

  it('gives a leaf no toggle at all', async () => {
    const user = userEvent.setup();
    installFetchMock(orgRoutes());

    renderApp('/org-chart');
    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));
    await within(tree).findByText('Nadia Hassan');
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Nadia Hassan' }));
    await within(tree).findByText('Youssef Adel');

    expect(
      screen.queryByRole('button', { name: /reports of Youssef Adel/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the error when the reports cannot be loaded', async () => {
    const user = userEvent.setup();
    installFetchMock(
      orgRoutes({ 'GET /api/org-chart/emp-9/children': { status: 500, body: { message: 'Boom' } } }),
    );

    renderApp('/org-chart');
    await screen.findByRole('list', { name: 'Organisation chart' });
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));

    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });

  it('shows the empty state when the tree has no root', async () => {
    installFetchMock(orgRoutes({ 'GET /api/org-chart': { body: [] } }));

    renderApp('/org-chart');

    expect(await screen.findByText('The org chart is empty.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Organisation chart' })).not.toBeInTheDocument();
  });

  it('supports paged continuation for roots and child reports', async () => {
    const user = userEvent.setup();
    const SECOND_ROOT = makeOrgNode({ id: 'emp-10', fullName: 'Second Root', childCount: 0 });
    const SECOND_CHILD = makeOrgNode({ id: 'emp-3', fullName: 'Second Child', childCount: 0 });

    installFetchMock({
      ...signedIn(),
      'GET /api/org-chart': {
        body: {
          content: [ROOT],
          page: 0,
          size: 1,
          totalElements: 2,
          totalPages: 2,
        },
      },
      'GET /api/org-chart?page=1&size=50': {
        body: {
          content: [SECOND_ROOT],
          page: 1,
          size: 1,
          totalElements: 2,
          totalPages: 2,
        },
      },
      'GET /api/org-chart/emp-9/children': {
        body: {
          content: [NADIA],
          page: 0,
          size: 1,
          totalElements: 2,
          totalPages: 2,
        },
      },
      'GET /api/org-chart/emp-9/children?page=1&size=50': {
        body: {
          content: [SECOND_CHILD],
          page: 1,
          size: 1,
          totalElements: 2,
          totalPages: 2,
        },
      },
    });

    renderApp('/org-chart');

    // Page 0 root is visible
    expect(await screen.findByText('Omar Said')).toBeInTheDocument();
    // Load more roots button is visible
    const loadMoreRootsBtn = await screen.findByRole('button', { name: /load more roots/i });
    expect(loadMoreRootsBtn).toBeInTheDocument();

    // Click load more roots
    await user.click(loadMoreRootsBtn);
    expect(await screen.findByText('Second Root')).toBeInTheDocument();

    // Expand Omar Said
    await user.click(screen.getByRole('button', { name: 'Expand the reports of Omar Said' }));
    const tree = await screen.findByRole('list', { name: 'Organisation chart' });
    expect(await within(tree).findByText('Nadia Hassan')).toBeInTheDocument();

    // Load more reports button is visible
    const loadMoreReportsBtn = await screen.findByRole('button', { name: /load more reports/i });
    expect(loadMoreReportsBtn).toBeInTheDocument();

    await user.click(loadMoreReportsBtn);
    expect(await within(tree).findByText('Second Child')).toBeInTheDocument();
  });
});
