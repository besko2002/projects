import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { useAuth } from '../context/useAuth';
import { ApiException } from '../api/client';
import { sanitizeReturnUrl } from '../utils/urlUtils';

export function SignInPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const rawReturnUrl = searchParams.get('return');
  const returnUrl = sanitizeReturnUrl(rawReturnUrl);
  const navigate = useNavigate();
  const { login, loginDemo = async () => {}, demoStatus } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDemoSubmitting, setIsDemoSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemoSignIn = async () => {
    setError(null);
    setIsDemoSubmitting(true);
    try {
      await loginDemo();
      navigate(returnUrl);
    } catch (err) {
      if (err instanceof ApiException) {
        setError(err.message || 'Failed to create demo session.');
      } else if (err instanceof Error) {
        setError(err.message || 'Failed to create demo session.');
      } else {
        setError('An unexpected error occurred creating demo session.');
      }
    } finally {
      setIsDemoSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login({ email, password });
      navigate(returnUrl);
    } catch (err) {
      if (err instanceof ApiException) {
        setError(err.message || 'Invalid email or password.');
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
          <div className="kicker">Box Office Access</div>
          <h2 style={{ marginTop: 'var(--space-2)' }}>Sign in to CineBook</h2>
          <p className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
            Access your bookings and reserve seats.
          </p>

          {error && (
            <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
            <div className="form-group">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                type="email"
                className="form-control"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                className="form-control"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn red"
              disabled={isSubmitting || isDemoSubmitting || !email || !password}
              style={{ width: '100%', marginTop: 'var(--space-2)' }}
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {demoStatus?.enabled && (
            <div className="demo-signin-card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--sand-light, #fbf7ee)', border: '2px dashed var(--teal)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span className="stamp" style={{ background: 'var(--teal)', color: '#fff', fontSize: '11px', padding: '2px 6px' }}>PORTFOLIO DEMO</span>
                <strong style={{ fontSize: '14px' }}>Reviewer One-Click Access</strong>
              </div>
              <p className="soft" style={{ fontSize: '13px', margin: '0 0 var(--space-3) 0', lineHeight: 1.4 }}>
                Reviewing CineBook? Start an isolated, temporary customer session without a password.
              </p>
              <button
                type="button"
                className="btn teal"
                onClick={handleDemoSignIn}
                disabled={isDemoSubmitting || isSubmitting}
                style={{ width: '100%' }}
                aria-label="Try demo session without password"
              >
                {isDemoSubmitting ? 'Creating session…' : '⚡ Try demo in 1 click'}
              </button>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 'var(--space-6)', fontSize: '14px' }}>
            <span className="soft">Don&apos;t have an account? </span>
            <Link
              to={`/register${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''}`}
              style={{ color: 'var(--red)', fontWeight: 800, textDecoration: 'underline' }}
            >
              Register here
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
