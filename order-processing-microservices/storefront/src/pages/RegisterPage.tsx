import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiException, errorMessage } from '../api/client';
import { useAuth } from '../state/auth';
import { sanitizeReturnPath } from '../utils/url';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = sanitizeReturnPath(params.get('return'));

  const [name, setName] = useState('');
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
    if (!name.trim()) {
      errors.name = 'Enter your name.';
    } else if (name.trim().length > 100) {
      errors.name = 'Your name must be at most 100 characters.';
    }
    if (!email.trim()) {
      errors.email = 'Enter your email address.';
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    if (!password) {
      errors.password = 'Choose a password.';
    } else if (password.length < 8) {
      errors.password = 'Use at least 8 characters.';
    } else if (password.length > 72) {
      errors.password = 'Use at most 72 characters.';
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors);
        } else if (err.status === 409) {
          setFieldErrors({ email: 'An account with this email already exists.' });
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError(errorMessage(err));
      }
      setSubmitting(false);
    }
  };

  const signInLink = returnTo === '/' ? '/signin' : `/signin?return=${encodeURIComponent(returnTo)}`;

  return (
    <>
      <div className="page-header">
        <h1>Create an account</h1>
        <p className="page-lede">
          One account owns its orders and payments. Browsing the catalog stays public.
        </p>
      </div>

      <div className="form-panel" style={{ maxWidth: '520px' }}>
        {formError && (
          <div className="alert alert--error" role="alert">
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="register-name">Name</label>
            <input
              id="register-name"
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
              aria-invalid={fieldErrors.name ? 'true' : undefined}
              aria-describedby={fieldErrors.name ? 'register-name-error' : undefined}
            />
            {fieldErrors.name && (
              <span className="field__error" id="register-name-error">
                {fieldErrors.name}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              aria-invalid={fieldErrors.email ? 'true' : undefined}
              aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
            />
            {fieldErrors.email && (
              <span className="field__error" id="register-email-error">
                {fieldErrors.email}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={
                fieldErrors.password ? 'register-password-error' : 'register-password-hint'
              }
            />
            <span className="field__hint" id="register-password-hint">
              8 to 72 characters.
            </span>
            {fieldErrors.password && (
              <span className="field__error" id="register-password-error">
                {fieldErrors.password}
              </span>
            )}
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
            {submitting ? 'Creating your account…' : 'Create account'}
          </button>
        </form>

        <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
          Already registered? <Link to={signInLink}>Sign in</Link>
        </p>
      </div>
    </>
  );
}
