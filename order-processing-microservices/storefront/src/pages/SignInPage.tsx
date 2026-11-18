import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { useAuth } from '../state/auth';
import { sanitizeReturnPath } from '../utils/url';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = sanitizeReturnPath(params.get('return'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const errors: Record<string, string> = {};
    if (!email.trim()) {
      errors.email = 'Enter your email address.';
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password) {
      errors.password = 'Enter your password.';
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.status === 401) {
          setFormError('Email or password is incorrect.');
        } else if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError(errorMessage(err));
      }
      setSubmitting(false);
    }
  };

  const registerLink = returnTo === '/' ? '/register' : `/register?return=${encodeURIComponent(returnTo)}`;

  return (
    <>
      <div className="page-header">
        <h1>Sign in</h1>
        <p className="page-lede">Sign in to check out and follow your orders through the saga.</p>
      </div>

      <div className="form-panel" style={{ maxWidth: '520px' }}>
        {formError && (
          <div className="alert alert--error" role="alert">
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              aria-invalid={fieldErrors.email ? 'true' : undefined}
              aria-describedby={fieldErrors.email ? 'signin-email-error' : undefined}
            />
            {fieldErrors.email && (
              <span className="field__error" id="signin-email-error">
                {fieldErrors.email}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={fieldErrors.password ? 'signin-password-error' : undefined}
            />
            {fieldErrors.password && (
              <span className="field__error" id="signin-password-error">
                {fieldErrors.password}
              </span>
            )}
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
          New here? <Link to={registerLink}>Create an account</Link>
        </p>
      </div>
    </>
  );
}
