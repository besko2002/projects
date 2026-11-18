import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../state/auth';
import { signInPath } from '../utils/url';
import { Loading } from './Feedback';

/**
 * Sends anonymous visitors to sign-in and comes back to the protected page afterwards. While a
 * stored token is being restored it waits instead of redirecting, so a refresh does not bounce a
 * signed-in customer to the sign-in form.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth();
  const location = useLocation();

  if (restoring) {
    return <Loading label="Checking your session…" />;
  }
  if (!user) {
    return <Navigate to={signInPath(`${location.pathname}${location.search}`)} replace />;
  }
  return <>{children}</>;
}
