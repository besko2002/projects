import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeAudit, makeEmployee, makePage, signedIn } from '../test/fixtures';
import { installFetchMock } from '../test/fetchMock';
import { renderApp } from '../test/helpers';
import type { RouteHandler } from '../test/fetchMock';

function detailRoutes(overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> {
  return {
    ...signedIn({ role: 'HR' }),
    'GET /api/employees/emp-1': { body: makeEmployee() },
    'GET /api/departments': { body: [{ id: 'dep-1', name: 'Finance', createdAt: '2023-01-01T00:00:00Z' }] },
    'GET /api/employees': {
      body: makePage([
        makeEmployee(),
        makeEmployee({ id: 'emp-9', fullName: 'Omar Said', employeeNumber: 'EMP-0009' }),
      ]),
    },
    'GET /api/audit/employees/emp-1': { body: makePage([makeAudit()]) },
    ...overrides,
  };
}

describe('employee detail', () => {
  it('supports keyboard navigation between Details and Audit tabs', async () => {
    const user = userEvent.setup();
    installFetchMock(detailRoutes());
    renderApp('/employees/emp-1');

    const details = await screen.findByRole('tab', { name: 'Details' });
    details.focus();
    await user.keyboard('{ArrowRight}');
    const audit = screen.getByRole('tab', { name: 'Audit' });
    expect(audit).toHaveFocus();
    expect(audit).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'Audit' })).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(details).toHaveFocus();
    expect(details).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(audit).toHaveFocus();
    await user.keyboard('{Home}');
    expect(details).toHaveFocus();
  });

  it('searches for a manager, leaves the employee themself out and posts the choice', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(detailRoutes({
      'GET /api/employees': {
        body: makePage([
          makeEmployee({ id: 'emp-1', fullName: 'Nadia Hassan', employeeNumber: 'EMP-0001' }),
          makeEmployee({ id: 'emp-101', fullName: 'Last Manager', employeeNumber: 'EMP-0101' }),
        ], { page: 0, size: 20, totalElements: 2, totalPages: 1 }),
      },
      'PUT /api/employees/emp-1/manager': {
        body: makeEmployee({ managerId: 'emp-101', managerName: 'Last Manager' }),
      },
    }));

    renderApp('/employees/emp-1');
    const input = await screen.findByRole('combobox', { name: /reports to/i });
    await user.type(input, 'Manager');

    const option = await screen.findByRole('option', { name: 'Last Manager · EMP-0101' });
    // The employee themself is never offered as their own manager.
    expect(screen.queryByRole('option', { name: 'Nadia Hassan · EMP-0001' })).not.toBeInTheDocument();
    await user.click(option);

    const put = mock.callsTo('PUT /api/employees/emp-1/manager');
    expect(put).toHaveLength(1);
    expect(put[put.length - 1].body).toEqual({ managerId: 'emp-101' });
    // The search asks the server for the typed text instead of loading the whole roster.
    expect(mock.urlsFor('GET', '/api/employees')).toEqual([
      '/api/employees?q=Manager&status=ACTIVE&page=0&size=20&sort=fullName%2Casc',
    ]);
  });

  it('exposes the search error and offers a retry', async () => {
    const user = userEvent.setup();
    installFetchMock(detailRoutes({
      'GET /api/employees': { status: 500, body: { message: 'Search unavailable' } },
    }));

    renderApp('/employees/emp-1');
    const input = await screen.findByRole('combobox', { name: /reports to/i });
    await user.type(input, 'Omar');

    expect(await screen.findByText('Search unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('asks for confirmation before terminating and only then posts', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      detailRoutes({
        'POST /api/employees/emp-1/terminate': {
          body: makeEmployee({ status: 'TERMINATED', terminatedAt: '2025-05-01T00:00:00Z' }),
        },
      }),
    );

    renderApp('/employees/emp-1');
    await user.click(await screen.findByRole('button', { name: 'Terminate employee' }));

    const dialog = await screen.findByRole('dialog', { name: 'Terminate Nadia Hassan?' });
    expect(mock.callsTo('POST /api/employees/emp-1/terminate')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Terminate' }));

    expect(mock.callsTo('POST /api/employees/emp-1/terminate')).toHaveLength(1);
    expect(await screen.findByText('Terminated')).toBeInTheDocument();
  });

  it('posts nothing when the termination dialog is dismissed', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(detailRoutes());

    renderApp('/employees/emp-1');
    await user.click(await screen.findByRole('button', { name: 'Terminate employee' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^(cancel|keep)/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mock.callsTo('POST /api/employees/emp-1/terminate')).toHaveLength(0);
  });

  it('sets a new manager through PUT .../manager', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      detailRoutes({
        'GET /api/employees': {
          body: makePage([makeEmployee({ id: 'emp-9', fullName: 'Omar Said' })],
            { page: 0, size: 20, totalElements: 1, totalPages: 1 }),
        },
        'PUT /api/employees/emp-1/manager': {
          body: makeEmployee({ managerId: 'emp-9', managerName: 'Omar Said' }),
        },
      }),
    );

    renderApp('/employees/emp-1');
    const input = await screen.findByRole('combobox', { name: /reports to/i });
    await user.type(input, 'Omar');
    await user.click(await screen.findByRole('option', { name: 'Omar Said · EMP-0001' }));

    const put = mock.callsTo('PUT /api/employees/emp-1/manager');
    expect(put).toHaveLength(1);
    expect(put[0].body).toEqual({ managerId: 'emp-9' });
  });

  it('shows the 409 cycle message when the manager change is refused', async () => {
    const user = userEvent.setup();
    installFetchMock(
      detailRoutes({
        'GET /api/employees': {
          body: makePage([makeEmployee({ id: 'emp-9', fullName: 'Omar Said' })],
            { page: 0, size: 20, totalElements: 1, totalPages: 1 }),
        },
        'PUT /api/employees/emp-1/manager': {
          status: 409,
          body: { status: 409, message: 'This manager assignment would create a cycle' },
        },
      }),
    );

    renderApp('/employees/emp-1');
    const input = await screen.findByRole('combobox', { name: /reports to/i });
    await user.type(input, 'Omar');
    await user.click(await screen.findByRole('option', { name: 'Omar Said · EMP-0001' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This manager assignment would create a cycle',
    );
  });

  it('sends null when the manager is cleared to make an org root', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      detailRoutes({
        'PUT /api/employees/emp-1/manager': { body: makeEmployee({ managerId: null, managerName: null }) },
      }),
    );

    renderApp('/employees/emp-1');
    const input = await screen.findByRole('combobox', { name: /reports to/i });
    await user.click(input);
    await user.click(await screen.findByRole('option', { name: 'No manager (org root)' }));

    expect(mock.callsTo('PUT /api/employees/emp-1/manager')[0].body).toEqual({ managerId: null });
  });

  it('renders the audit trail with the field, both values and who changed it', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      detailRoutes({
        'GET /api/audit/employees/emp-1': {
          body: makePage([
            makeAudit({ field: 'salary', before: '17000.00', after: '18500.00' }),
            makeAudit({
              revision: 13,
              field: 'jobTitle',
              before: 'Junior Analyst',
              after: 'Analyst',
              changedBy: 'hr@hr.local',
            }),
          ]),
        },
      }),
    );

    renderApp('/employees/emp-1');
    await user.click(await screen.findByRole('tab', { name: 'Audit' }));

    const table = await screen.findByRole('table', { name: /audited field changes/i });
    const salaryRow = within(table).getByRole('row', { name: /17,?000\.00/ });
    expect(within(salaryRow).getByText('18500.00')).toBeInTheDocument();
    expect(within(salaryRow).getByText('admin@hr.local')).toBeInTheDocument();
    const titleRow = within(table).getByRole('row', { name: /Junior Analyst/ });
    expect(within(titleRow).getByText('hr@hr.local')).toBeInTheDocument();
    expect(mock.urlsFor('GET', '/api/audit/employees/emp-1')).toContain(
      '/api/audit/employees/emp-1?page=0&size=20',
    );
  });

  it('does not fetch the audit trail before the tab is opened', async () => {
    const mock = installFetchMock(detailRoutes());

    renderApp('/employees/emp-1');
    await screen.findByRole('heading', { name: 'Nadia Hassan' });

    expect(mock.urlsFor('GET', '/api/audit/employees/emp-1')).toHaveLength(0);
  });

  it('shows the audit empty state when nothing tracked has changed', async () => {
    const user = userEvent.setup();
    installFetchMock(detailRoutes({ 'GET /api/audit/employees/emp-1': { body: makePage([]) } }));

    renderApp('/employees/emp-1');
    await user.click(await screen.findByRole('tab', { name: 'Audit' }));

    expect(await screen.findByText('No tracked change yet.')).toBeInTheDocument();
  });
});
