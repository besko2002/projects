import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeLeaveRequest, makePage, makeTeamMember, signedIn } from '../test/fixtures';
import { installFetchMock } from '../test/fetchMock';
import { renderApp } from '../test/helpers';

const firstTen = Array.from({ length: 10 }, (_, i) => makeLeaveRequest({ id: `queue-${i}`, employeeName: `Pending Employee ${i}` }));
const last = makeLeaveRequest({ id: 'queue-last', employeeName: 'Last Page Employee' });

describe('approval pagination recovery', () => {
  it('returns to a valid page after deciding the sole request on the last page', async () => {
    let decided = false;
    const mock = installFetchMock({
      ...signedIn({ team: [makeTeamMember()] }),
      'GET /api/leave/requests/pending?page=0&size=10': () => ({ body: makePage(firstTen, { page: 0, size: 10, totalElements: decided ? 10 : 11, totalPages: decided ? 1 : 2 }) }),
      'GET /api/leave/requests/pending?page=1&size=10': () => ({ body: makePage(decided ? [] : [last], { page: 1, size: 10, totalElements: decided ? 10 : 11, totalPages: decided ? 1 : 2 }) }),
      'POST /api/leave/requests/queue-last/approve': () => { decided = true; return { body: { ...last, status: 'APPROVED' } }; },
    });
    const user = userEvent.setup();
    renderApp('/approvals');
    await screen.findByText('Pending Employee 0');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: /^Approve Last Page Employee/ }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Pending Employee 0');
    await waitFor(() => expect(screen.getByText('Page 1 of 1 · 10 total')).toBeInTheDocument());
    expect(mock.urlsFor('GET', '/api/leave/requests/pending')).toEqual([
      '/api/leave/requests/pending?page=0&size=10', '/api/leave/requests/pending?page=1&size=10', '/api/leave/requests/pending?page=0&size=10',
    ]);
    expect(screen.queryByText('Every request has been decided.')).not.toBeInTheDocument();
  });

  it('keeps recovery navigation if another reviewer empties the requested page', async () => {
    installFetchMock({
      ...signedIn({ team: [makeTeamMember()] }),
      'GET /api/leave/requests/pending?page=0&size=10': { body: makePage(firstTen, { page: 0, size: 10, totalElements: 11, totalPages: 2 }) },
      'GET /api/leave/requests/pending?page=1&size=10': { body: makePage([], { page: 1, size: 10, totalElements: 10, totalPages: 1 }) },
    });
    const user = userEvent.setup();
    renderApp('/approvals');
    await screen.findByText('Pending Employee 0');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('No requests on this page.');
    expect(screen.queryByText('Every request has been decided.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'First page' }));
    await screen.findByText('Pending Employee 0');
  });
});
