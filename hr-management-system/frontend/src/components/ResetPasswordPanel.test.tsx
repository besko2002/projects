import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResetPasswordPanel } from './ResetPasswordPanel';
import { makeEmployee } from '../test/fixtures';
import { installFetchMock } from '../test/fetchMock';

const viewer = vi.hoisted(() => ({ role: 'HR', user: { id: 'viewer' } }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => viewer }));

 describe('ResetPasswordPanel', () => {
  it.each([
    ['EMPLOYEE', 'target', 'EMPLOYEE', 'ACTIVE'],
    ['HR', 'viewer', 'HR', 'ACTIVE'],
    ['HR', 'target', 'ADMIN', 'ACTIVE'],
    ['ADMIN', 'target', 'EMPLOYEE', 'TERMINATED'],
  ] as const)('hides forbidden target for %s', (role, id, targetRole, status) => {
    viewer.role = role;
    render(<ResetPasswordPanel employee={makeEmployee({ id, role: targetRole, status })} />);
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });

  it('requires a reason and acknowledgment, shows secret once and reports copy feedback', async () => {
    viewer.role = 'HR';
    const user = userEvent.setup();
    const onReset = vi.fn();
    const mock = installFetchMock({
      'POST /api/employees/target/reset-password': { body: { employeeId: 'target', temporaryPassword: 'OneTime@12345' } },
    });
    render(<ResetPasswordPanel employee={makeEmployee({ id: 'target' })} onReset={onReset} />);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(await screen.findByText('Enter an audit reason of 1 to 400 characters.')).toBeInTheDocument();
    expect(mock.calls).toHaveLength(0);
    await user.type(screen.getByLabelText(/Audit reason/), 'Identity checked');
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(await screen.findByText('OneTime@12345')).toBeInTheDocument();
    expect(mock.calls[0].body).toEqual({ reason: 'Identity checked' });
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByText('OneTime@12345')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied to the clipboard.')).toBeInTheDocument();
    expect(JSON.stringify(localStorage)).not.toContain('OneTime@12345');
    expect(JSON.stringify(sessionStorage)).not.toContain('OneTime@12345');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('OneTime@12345')).not.toBeInTheDocument();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed reset recoverable without displaying a password', async () => {
    viewer.role = 'ADMIN';
    const user = userEvent.setup();
    installFetchMock({ 'POST /api/employees/target/reset-password': { status: 400, body: { message: 'Only active employees can have their password reset' } } });
    render(<ResetPasswordPanel employee={makeEmployee({ id: 'target' })} />);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    await user.type(screen.getByLabelText(/Audit reason/), 'Verified');
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(await screen.findByText('Only active employees can have their password reset')).toBeInTheDocument();
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm reset' })).toBeEnabled();
  });
});
