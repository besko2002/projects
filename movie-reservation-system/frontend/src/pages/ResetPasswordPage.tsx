import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import * as authApi from '../api/authApi';
import { ApiException } from '../api/client';

export function ResetPasswordPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Password reset token is missing. Please request a new reset link.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword.length > 72) {
      setError('Password must be at most 72 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await authApi.resetPassword({ token, newPassword });
      setSuccessMessage(res.message);
    } catch (err) {
      if (err instanceof ApiException) {
        setError(err.message || 'Failed to reset password. The link may have expired.');
      } else {
        setError('An unexpected error occurred. Please try again or request a new reset link.');
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
          <div className="kicker">Security Update</div>
          <h2 style={{ marginTop: 'var(--space-2)' }}>Choose a new password</h2>
          <p className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)', lineHeight: 1.5 }}>
            Passwords must contain at least 8 characters. Resetting your password signs out all existing sessions.
          </p>

          {!token && (
            <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
              This reset link is missing a token. Please{' '}
              <Link to="/forgot-password" style={{ textDecoration: 'underline', color: 'inherit', fontWeight: 'bold' }}>
                request a new password reset email
              </Link>.
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
              {error}
            </div>
          )}

          {successMessage ? (
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
                ✓ Password Reset Complete
              </h3>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--ink)' }}>
                {successMessage}
              </p>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <button
                  type="button"
                  className="btn red"
                  onClick={() => navigate('/login')}
                  style={{ width: '100%' }}
                >
                  Sign in with new password
                </button>
              </div>
            </div>
          ) : (
            token && (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
                <div className="form-group">
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    className="form-control"
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    maxLength={72}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    className="form-control"
                    placeholder="Repeat new password"
                    required
                    minLength={8}
                    maxLength={72}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                <button
                  type="submit"
                  className="btn red"
                  disabled={isSubmitting || !newPassword || !confirmPassword}
                  style={{ width: '100%', marginTop: 'var(--space-2)' }}
                >
                  {isSubmitting ? 'Updating password...' : 'Update password'}
                </button>

                <div style={{ textAlign: 'center', marginTop: 'var(--space-4)', fontSize: '14px' }}>
                  <Link to="/login" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
                    Cancel and return to Sign in
                  </Link>
                </div>
              </form>
            )
          )}
        </div>
      </main>
    </div>
  );
}
