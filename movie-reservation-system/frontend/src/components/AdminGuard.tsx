import React from 'react';
import { Navigate, useLocation, Link } from 'react-router';
import { useAuth } from '../context/useAuth';
import { TopBar } from './TopBar';

export function AdminGuard({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="screen screen-container">
        <TopBar />
        <main className="wrap" style={{ textAlign: 'center', padding: 'var(--space-12) 0' }}>
          <p className="soft">Authenticating staff credentials…</p>
        </main>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/login?return=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (user.role !== 'ADMIN') {
    return (
      <div className="screen screen-container">
        <TopBar />
        <main className="wrap">
          <div className="form-card" style={{ maxWidth: '520px', margin: 'var(--space-8) auto', textAlign: 'center' }}>
            <div className="kicker" style={{ color: 'var(--red)' }}>403 Forbidden</div>
            <h2 style={{ marginTop: 'var(--space-2)' }}>Staff Administration Only</h2>
            <p className="soft" style={{ fontSize: '14px', margin: 'var(--space-3) 0', lineHeight: 1.6 }}>
              You are signed in as <strong>{user.name}</strong> ({user.email}) with standard customer privileges. Staff administrative credentials are required to access management consoles.
            </p>
            <div style={{ marginTop: 'var(--space-6)' }}>
              <Link to="/" className="btn red" style={{ width: '100%', display: 'inline-block' }}>
                Return to Box Office
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
