import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { makePayslip, makePayslipPage, makeRun, makeRunDetail, signedIn, TOKEN } from '../test/fixtures';
import { installFetchMock } from '../test/fetchMock';
import { renderApp } from '../test/helpers';
import type { RouteHandler } from '../test/fetchMock';

function runRoutes(overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> {
  return {
    ...signedIn({ role: 'HR' }),
    'GET /api/payroll/runs/run-1': { body: makeRunDetail() },
    'GET /api/payroll/runs/run-1/payslips': { body: makePayslipPage() },
    ...overrides,
  };
}

/** Records the blobs handed to the browser, since jsdom has no real object URLs. */
function captureObjectUrls(): Blob[] {
  const saved: Blob[] = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      saved.push(blob);
      return 'blob:payroll';
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined });
  return saved;
}

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('payroll run detail', () => {
  it('renders the totals and the payslips of the run', async () => {
    installFetchMock(runRoutes());

    renderApp('/payroll/run-1');

    expect(await screen.findByRole('heading', { name: 'March 2025' })).toBeInTheDocument();
    // Net pay appears both in the totals and on the single payslip row.
    expect(screen.getAllByText('15,751.26')).toHaveLength(2);
    const table = await screen.findByRole('table', { name: /payslips in this run/i });
    const row = within(table).getByRole('row', { name: /Nadia Hassan/ });
    expect(within(row).getByText('Finance')).toBeInTheDocument();
    expect(within(row).getByText('18,500.00')).toBeInTheDocument();
  });

  it('offers Recalculate, Finalize and Delete draft only while the run is a DRAFT', async () => {
    installFetchMock(runRoutes());

    renderApp('/payroll/run-1');

    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeInTheDocument();
  });

  it('hides Recalculate, Finalize and Delete draft once the run is finalized', async () => {
    installFetchMock(
      runRoutes({
        'GET /api/payroll/runs/run-1': {
          body: makeRunDetail({
            run: makeRun({ status: 'FINALIZED', finalizedAt: '2025-04-02T08:00:00Z' }),
          }),
        },
      }),
    );

    renderApp('/payroll/run-1');

    expect(await screen.findByRole('heading', { name: 'Totals' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download XLSX' })).toBeInTheDocument();
  });

  it('asks for confirmation before finalizing and only then posts', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      runRoutes({
        'POST /api/payroll/runs/run-1/finalize': {
          body: makeRunDetail({ run: makeRun({ status: 'FINALIZED' }) }),
        },
      }),
    );

    renderApp('/payroll/run-1');
    await user.click(await screen.findByRole('button', { name: 'Finalize' }));

    const dialog = await screen.findByRole('dialog', { name: 'Finalize this run?' });
    expect(mock.callsTo('POST /api/payroll/runs/run-1/finalize')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Finalize' }));

    expect(mock.callsTo('POST /api/payroll/runs/run-1/finalize')).toHaveLength(1);
  });

  it('shows the 409 message when a finalized run is recalculated', async () => {
    const user = userEvent.setup();
    installFetchMock(
      runRoutes({
        'POST /api/payroll/runs/run-1/recalculate': {
          status: 409,
          body: { status: 409, message: 'A finalized payroll run cannot be recalculated' },
        },
      }),
    );

    renderApp('/payroll/run-1');
    await user.click(await screen.findByRole('button', { name: 'Recalculate' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Recalculate' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A finalized payroll run cannot be recalculated',
    );
  });

  it('reloads and resets paged payslips to page 0 after recalculation', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      runRoutes({
        'POST /api/payroll/runs/run-1/recalculate': {
          body: makeRunDetail({ run: makeRun({ status: 'DRAFT', payslipCount: 2 }) }),
        },
        'GET /api/payroll/runs/run-1/payslips?page=0&size=50': {
          body: makePayslipPage({ page: 0, totalPages: 2, totalElements: 2 }),
        },
        'GET /api/payroll/runs/run-1/payslips?page=1&size=50': {
          body: makePayslipPage({
            content: [{ ...makePayslip({ runStatus: 'DRAFT' }), id: 'pay-2', employeeName: 'Second Employee' }],
            page: 1,
            totalPages: 2,
            totalElements: 2,
          }),
        },
      }),
    );

    renderApp('/payroll/run-1');
    // Navigate to page 1
    const nextButton = await screen.findByRole('button', { name: 'Next' });
    await user.click(nextButton);
    expect(await screen.findByText('Second Employee')).toBeInTheDocument();

    // Trigger recalculation
    await user.click(screen.getByRole('button', { name: 'Recalculate' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Recalculate' }),
    );

    expect(await screen.findByText('Payroll run recalculated.')).toBeInTheDocument();
    expect(mock.callsTo('POST /api/payroll/runs/run-1/recalculate')).toHaveLength(1);
    // Verifies payslips reset back to page 0
    expect(await screen.findByText('Page 1 of 2 · 2 payslips')).toBeInTheDocument();
  });

  it('prevents out-of-range pagination and disables navigation buttons appropriately', async () => {
    installFetchMock(
      runRoutes({
        'GET /api/payroll/runs/run-1/payslips': {
          body: makePayslipPage({ page: 0, totalPages: 1, totalElements: 1 }),
        },
      }),
    );

    renderApp('/payroll/run-1');
    const prevButton = await screen.findByRole('button', { name: 'Previous' });
    const nextButton = screen.getByRole('button', { name: 'Next' });

    // On single-page run (page 0 of 1), both Previous and Next are disabled
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
  });

  it('deletes the draft after confirmation and returns to the payroll list', async () => {
    const user = userEvent.setup();
    const mock = installFetchMock(
      runRoutes({
        'DELETE /api/payroll/runs/run-1': { status: 204 },
        'GET /api/payroll/runs?page=0&size=12': { body: { content: [], page: 0, size: 12, totalElements: 0, totalPages: 0 } },
      }),
    );

    renderApp('/payroll/run-1');
    await user.click(await screen.findByRole('button', { name: 'Delete draft' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Delete this draft run?' })).getByRole(
        'button',
        { name: 'Delete draft' },
      ),
    );

    expect(mock.callsTo('DELETE /api/payroll/runs/run-1')).toHaveLength(1);
    expect(await screen.findByText('No payroll run yet.')).toBeInTheDocument();
  });

  it('downloads the register as an authenticated blob', async () => {
    const user = userEvent.setup();
    const saved = captureObjectUrls();
    const xlsx = new Blob(['xlsx-bytes']);
    const mock = installFetchMock(
      runRoutes({ 'GET /api/payroll/runs/run-1/export.xlsx': { blob: xlsx } }),
    );

    renderApp('/payroll/run-1');
    await user.click(await screen.findByRole('button', { name: 'Download XLSX' }));

    expect(await screen.findByText('Register downloaded.')).toBeInTheDocument();
    const call = mock.callsTo('GET /api/payroll/runs/run-1/export.xlsx')[0];
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.headers.Accept).toBe('application/octet-stream');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBeInstanceOf(Blob);
  });

  it('downloads one payslip PDF with the bearer token', async () => {
    const user = userEvent.setup();
    const saved = captureObjectUrls();
    const mock = installFetchMock(
      runRoutes({ 'GET /api/payroll/payslips/pay-1/pdf': { blob: new Blob(['%PDF-1.7']) } }),
    );

    renderApp('/payroll/run-1');
    await user.click(
      await screen.findByRole('button', { name: 'Download the payslip of Nadia Hassan as PDF' }),
    );

    const call = mock.callsTo('GET /api/payroll/payslips/pay-1/pdf')[0];
    expect(call).toBeDefined();
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(saved).toHaveLength(1);
  });
});
