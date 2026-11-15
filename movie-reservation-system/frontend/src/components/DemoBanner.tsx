import React, { useState } from 'react';
import { useAuth } from '../context/useAuth';

export function DemoBanner(): React.JSX.Element | null {
  const { demoStatus, user, loginDemo = async () => {} } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!demoStatus?.enabled) {
    return null;
  }

  const handleStartDemo = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await loginDemo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start demo session');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside className="demo-banner" role="region" aria-label="Portfolio demo guide">
      <div className="demo-banner-inner">
        <div className="demo-banner-summary">
          <span className="demo-badge" aria-hidden="true">DEMO</span>
          <span className="demo-banner-text">
            Portfolio demo — fictional data, Stripe test payments only.
          </span>
        </div>
        <div className="demo-banner-actions">
          {!user && (
            <button
              type="button"
              className="demo-btn-quick"
              onClick={handleStartDemo}
              disabled={isLoading}
              aria-label="Start one-click demo session"
            >
              {isLoading ? 'Starting…' : '⚡ Try demo'}
            </button>
          )}
          <button
            type="button"
            className="demo-btn-toggle"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls="demo-guide-details"
          >
            {isOpen ? 'Close guide ▴' : 'Reviewer guide ▾'}
          </button>
        </div>
      </div>

      {error && (
        <div className="demo-banner-error" role="alert">
          {error}
        </div>
      )}

      {isOpen && (
        <div id="demo-guide-details" className="demo-guide-content">
          <div className="demo-guide-grid">
            <div className="demo-guide-col">
              <h4>🍿 Browsing & Schedules</h4>
              <p>
                Browse movies, showtimes across the next 7 days, and live cinema hall seating without an account.
                Showtimes update dynamically to ensure today and future dates are always bookable.
              </p>
            </div>
            <div className="demo-guide-col">
              <h4>⚡ One-Click Customer Access</h4>
              <p>
                Clicking <strong>Try demo</strong> creates a temporary, isolated customer account with a genuine backend-issued JWT.
                No password required. Each visitor session is strictly private; visitors cannot see or cancel each other&apos;s bookings.
              </p>
            </div>
            <div className="demo-guide-col">
              <h4>💳 Stripe Test Payments</h4>
              <p>
                Payments use real Stripe Checkout in <strong>TEST mode</strong>. <em>Never use a real credit card!</em>
                Use test card: <code className="test-card-code">4242 4242 4242 4242</code>, any future MM/YY (e.g. <code>12/34</code>), and any 3-digit CVC (e.g. <code>123</code>).
              </p>
            </div>
            <div className="demo-guide-col">
              <h4>🎟️ Live Holds & Refunds</h4>
              <p>
                Reservations genuinely lock seats in PostgreSQL with a 10-minute hold countdown. Webhooks confirm payments into ticket QR codes.
                Full ticket cancellation and automated refund is available until 2 hours before showtime.
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
