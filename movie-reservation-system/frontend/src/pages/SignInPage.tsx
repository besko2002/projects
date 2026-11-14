import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { useAuth } from '../context/useAuth';
import { ApiException } from '../api/client';

export function SignInPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get('return') || '/';
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="screen-container">
      <TopBar />

      <main className="wrap">
        <div className="form-card">
          <h2>Sign in to CineBook</h2>
          <p className="muted" style={{ fontSize: '14px' }}>
            Access your bookings and reserve tickets.
          </p>

          {error && <div className="error-banner" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
              className="btn btn-primary"
              disabled={isSubmitting || !email || !password}
              style={{ width: '100%', marginTop: 'var(--space-2)' }}
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 'var(--space-2)', fontSize: '14px' }}>
            <span className="muted">Don&apos;t have an account? </span>
            <Link to={`/register${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''}`} style={{ color: 'var(--amber)', fontWeight: 700 }}>
              Register here
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
