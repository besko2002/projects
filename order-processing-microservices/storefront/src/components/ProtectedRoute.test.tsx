import { screen } from '@testing-library/react';
import { Route, Routes, useSearchParams } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { authValue } from '../test/factories';
import { renderWithProviders } from '../test/render';

function SignInProbe() {
  const [params] = useSearchParams();
  return <p>signin screen return={params.get('return')}</p>;
}

function routes() {
  return (
    <Routes>
      <Route
        path="/checkout"
        element={
          <ProtectedRoute>
            <p>protected content</p>
          </ProtectedRoute>
        }
      />
      <Route path="/signin" element={<SignInProbe />} />
    </Routes>
  );
}

describe('ProtectedRoute', () => {
  it('sends anonymous visitors to sign-in with a safe return path', () => {
    renderWithProviders(routes(), {
      auth: authValue({ user: null }),
      route: '/checkout',
    });

    expect(screen.getByText('signin screen return=/checkout')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('waits while a stored session is being restored instead of redirecting', () => {
    renderWithProviders(routes(), {
      auth: authValue({ user: null, restoring: true }),
      route: '/checkout',
    });

    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    expect(screen.queryByText('signin screen return=/checkout')).not.toBeInTheDocument();
  });

  it('renders the page for a signed-in customer', () => {
    renderWithProviders(routes(), { route: '/checkout' });

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});
