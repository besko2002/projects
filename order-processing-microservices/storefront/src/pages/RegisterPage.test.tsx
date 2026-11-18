import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../api/client';
import { authValue, userFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { RegisterPage } from './RegisterPage';

function renderRegister(route = '/register') {
  const auth = authValue({ user: null });
  const view = renderWithProviders(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/checkout" element={<p>checkout target</p>} />
      <Route path="/" element={<p>home target</p>} />
    </Routes>,
    { auth, route },
  );
  return { ...view, auth };
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, password = 'long-enough-password') {
  await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
  await user.type(screen.getByLabelText('Email'), 'ada@example.test');
  await user.type(screen.getByLabelText('Password'), password);
}

describe('RegisterPage', () => {
  it('validates required fields before calling the API', async () => {
    const user = userEvent.setup();
    const { auth } = renderRegister();

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Choose a password.')).toBeInTheDocument();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('enforces the 8-character minimum locally', async () => {
    const user = userEvent.setup();
    const { auth } = renderRegister();

    await fillForm(user, 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('maps a duplicate email to the email field', async () => {
    const user = userEvent.setup();
    const { auth } = renderRegister();
    auth.register.mockRejectedValueOnce(
      new ApiException({ status: 409, error: 'Conflict', message: 'Email already registered' }),
    );

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
  });

  it('registers and returns to the original destination', async () => {
    const user = userEvent.setup();
    const { auth } = renderRegister('/register?return=%2Fcheckout');
    auth.register.mockResolvedValue(userFixture);

    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('checkout target')).toBeInTheDocument();
    expect(auth.register).toHaveBeenCalledWith(
      'Ada Lovelace',
      'ada@example.test',
      'long-enough-password',
    );
  });
});
