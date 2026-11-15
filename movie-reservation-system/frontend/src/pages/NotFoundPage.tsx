import React from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';

export function NotFoundPage(): React.JSX.Element {
  return (
    <div className="screen screen-container">
      <TopBar />

      <main className="wrap">
        <div
          style={{
            maxWidth: '520px',
            margin: 'var(--space-12) auto',
            textAlign: 'center',
            border: '3px solid var(--ink)',
            background: 'var(--paper)',
            boxShadow: 'var(--shadow)',
            padding: 'var(--space-8) var(--space-6)',
          }}
        >
          <div className="kicker">404 Error</div>
          <h1 style={{ marginTop: 'var(--space-2)' }}>Scene not found</h1>
          <p className="soft" style={{ margin: 'var(--space-4) 0 var(--space-6)', lineHeight: 1.6 }}>
            The showtime or screen you are looking for has departed or does not exist in our cinema catalogue.
          </p>
          <Link to="/" className="btn red">
            Back to movies
          </Link>
        </div>
      </main>
    </div>
  );
}
