import React from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';

export function NotFoundPage(): React.JSX.Element {
  return (
    <div className="screen-container">
      <TopBar />

      <main className="wrap">
        <div style={{ maxWidth: '500px', margin: 'var(--space-12) auto', textAlign: 'center' }}>
          <h1>404</h1>
          <h2 style={{ marginTop: 'var(--space-2)' }}>Page not found</h2>
          <p className="muted" style={{ margin: 'var(--space-4) 0 var(--space-6)' }}>
            The screen or showtime you are looking for does not exist.
          </p>
          <Link to="/" className="btn btn-primary">
            Back to movies
          </Link>
        </div>
      </main>
    </div>
  );
}
