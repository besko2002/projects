import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../api/client';
import { authValue, userFixture } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { SignInPage } from './SignInPage';

function renderSignIn(route = '/signin') {
  const auth = authValue({ user: null });
  const view = renderWithProviders(
    <Routes>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/checkout" element={<p>checkout target</p>} />
      <Route path="/" element={<p>home target</p>} />
    </Routes>,
    { auth, route },
  );
  return { ...view, auth };
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'ada@example.test');
  await user.type(screen.getByLabelText('Password'), 'outline-c-password');
}

describe('SignInPage', () => {
  it('validates the form before calling the API', async () => {
    const user = userEvent.setup();
    const { auth } = renderSignIn();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('reports wrong credentials and re-enables the form', async () => {
    const user = userEvent.setup();
    const { auth } = renderSignIn();
    auth.signIn.mockRejectedValueOnce(
      new ApiException({ status: 401, error: 'Unauthorized', message: 'Invalid credentials' }),
    );

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('returns to the page the customer came from', async () => {
    const user = userEvent.setup();
    const { auth } = renderSignIn('/signin?return=%2Fcheckout');
    auth.signIn.mockResolvedValue(userFixture);

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('checkout target')).toBeInTheDocument();
    expect(auth.signIn).toHaveBeenCalledWith('ada@example.test', 'outline-c-password');
  });

  it('refuses an external return path', async () => {
    const user = userEvent.setup();
    const { auth } = renderSignIn('/signin?return=%2F%2Fevil.example');
    auth.signIn.mockResolvedValue(userFixture);

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('home target')).toBeInTheDocument();
    expect(screen.queryByText('checkout target')).not.toBeInTheDocument();
  });

  it('cannot be submitted twice while a request is in flight', async () => {
    const user = userEvent.setup();
    const { auth } = renderSignIn();
    auth.signIn.mockReturnValue(new Promise<never>(() => {}));

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Signing in…' }));

    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });
});
