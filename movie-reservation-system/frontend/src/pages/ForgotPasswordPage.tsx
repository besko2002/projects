import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';
import * as authApi from '../api/authApi';
import { getAuthConfig } from '../api/adminApi';
import { ApiException } from '../api/client';

export function ForgotPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isServiceAvailable, setIsServiceAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let ignore = false;
    getAuthConfig()
      .then((cfg) => {
        if (!ignore) {
          setIsServiceAvailable(cfg.passwordResetEnabled);
        }
      })
      .catch(() => {
        if (!ignore) {
          setIsServiceAvailable(true); // Attempt submit anyway; backend will respond
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await authApi.forgotPassword({ email });
      setSubmittedMessage(res.message);
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.status === 503) {
          setIsServiceAvailable(false);
          setError('Password reset is currently unavailable because an email delivery provider is not configured.');
        } else {
          setError(err.message || 'Failed to submit reset request.');
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="screen screen-container">
      <TopBar />

      <main className="wrap">
        <div className="form-card" style={{ maxWidth: '480px', margin: 'var(--space-8) auto' }}>
          <div className="kicker">Account Recovery</div>
          <h2 style={{ marginTop: 'var(--space-2)' }}>Forgot your password?</h2>
          <p className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)', lineHeight: 1.5 }}>
            Enter your email address and we will dispatch a secure 30-minute password reset link.
          </p>

          {isServiceAvailable === false && (
            <div
              className="error-banner"
              role="alert"
              style={{ marginTop: 'var(--space-4)', background: 'var(--sand-light, #fbf7ee)', border: '1px solid var(--mustard)', color: 'var(--ink)' }}
            >
              <strong>Notice:</strong> Password reset by email is currently unavailable because no outgoing email service is configured. Please contact the theater box office directly.
            </div>
          )}

          {error && isServiceAvailable !== false && (
            <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
              {error}
            </div>
          )}

          {submittedMessage ? (
            <div
              style={{
                marginTop: 'var(--space-6)',
                padding: 'var(--space-4)',
                background: 'var(--sand-light, #fbf7ee)',
                border: '2px solid var(--teal)',
                borderRadius: '4px',
              }}
            >
              <h3 style={{ margin: '0 0 var(--space-2) 0', color: 'var(--teal)', fontSize: '16px' }}>
                ✓ Check your inbox
              </h3>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--ink)' }}>
                {submittedMessage}
              </p>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Link to="/login" className="btn teal" style={{ width: '100%', textAlign: 'center' }}>
                  Return to Sign in
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
              <div className="form-group">
                <label htmlFor="recovery-email">Account Email</label>
                <input
                  id="recovery-email"
                  type="email"
                  className="form-control"
                  placeholder="patron@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting || isServiceAvailable === false}
                />
              </div>

              <button
                type="submit"
                className="btn red"
                disabled={isSubmitting || !email || isServiceAvailable === false}
                style={{ width: '100%', marginTop: 'var(--space-2)' }}
              >
                {isSubmitting ? 'Sending link...' : 'Send reset link'}
              </button>

              <div style={{ textAlign: 'center', marginTop: 'var(--space-4)', fontSize: '14px' }}>
                <Link to="/login" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
                  ← Back to Sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
