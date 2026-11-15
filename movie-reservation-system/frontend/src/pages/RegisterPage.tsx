import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { useAuth } from '../context/useAuth';
import { ApiException } from '../api/client';
import { sanitizeReturnUrl } from '../utils/urlUtils';

export function RegisterPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const rawReturnUrl = searchParams.get('return');
  const returnUrl = sanitizeReturnUrl(rawReturnUrl);
  const navigate = useNavigate();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8 || password.length > 72) {
      setError('Password must be between 8 and 72 characters.');
      return;
    }

    setIsSubmitting(true);

    try {
      await register({ name, email, password });
      navigate(returnUrl);
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.fieldErrors) {
          const firstErr = Object.values(err.fieldErrors)[0];
          setError(firstErr || err.message);
        } else {
          setError(err.message || 'Registration failed.');
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
          <div className="kicker">New Patron Registration</div>
          <h2 style={{ marginTop: 'var(--space-2)' }}>Create your CineBook account</h2>
          <p className="soft" style={{ fontSize: '14px', marginTop: 'var(--space-1)' }}>
            Book seats, track orders, and manage refunds easily.
          </p>

          {error && (
            <div className="error-banner" role="alert" style={{ marginTop: 'var(--space-4)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
            <div className="form-group">
              <label htmlFor="register-name">Full name</label>
              <input
                id="register-name"
                type="text"
                className="form-control"
                placeholder="Ada Lovelace"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-email">Email address</label>
              <input
                id="register-email"
                type="email"
                className="form-control"
                placeholder="ada@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-password">Password (8–72 characters)</label>
              <input
                id="register-password"
                type="password"
                className="form-control"
                placeholder="••••••••"
                required
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn red"
              disabled={isSubmitting || !name || !email || !password}
              style={{ width: '100%', marginTop: 'var(--space-2)' }}
            >
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 'var(--space-6)', fontSize: '14px' }}>
            <span className="soft">Already have an account? </span>
            <Link
              to={`/login${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''}`}
              style={{ color: 'var(--red)', fontWeight: 800, textDecoration: 'underline' }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
