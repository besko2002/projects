import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TopBar } from '../components/TopBar';
import { useAuth } from '../context/useAuth';
import { ApiException } from '../api/client';
import { getAuthConfig } from '../api/adminApi';
import { sanitizeReturnUrl } from '../utils/urlUtils';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              text?: string;
              shape?: string;
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

export function SignInPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const rawReturnUrl = searchParams.get('return');
  const returnUrl = sanitizeReturnUrl(rawReturnUrl);
  const navigate = useNavigate();
  const { login, loginWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  const googleBtnContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let ignore = false;
    getAuthConfig()
      .then((cfg) => {
        if (!ignore && cfg.googleClientId) {
          setGoogleClientId(cfg.googleClientId);
        }
      })
      .catch(() => {
        // Ignored - Google sign-in remains disabled
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId) return;

    let ignore = false;
    const handleCredentialResponse = async (response: { credential: string }) => {
      if (!loginWithGoogle) return;
      setError(null);
      setIsGoogleSubmitting(true);
      try {
        await loginWithGoogle(response.credential);
        navigate(returnUrl);
      } catch (err) {
        if (err instanceof ApiException) {
          setError(err.message || 'Google sign-in failed.');
        } else {
          setError('An unexpected error occurred during Google sign-in.');
        }
      } finally {
        setIsGoogleSubmitting(false);
      }
    };

    const initGoogleGsi = () => {
      if (window.google?.accounts?.id && googleBtnContainerRef.current) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleCredentialResponse,
        });
        googleBtnContainerRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleBtnContainerRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 380,
        });
      }
    };

    if (window.google?.accounts?.id) {
      initGoogleGsi();
    } else {
      const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (!ignore) initGoogleGsi();
        };
        document.body.appendChild(script);
      } else {
        existingScript.addEventListener('load', () => {
          if (!ignore) initGoogleGsi();
        });
      }
    }

    return () => {
      ignore = true;
    };
  }, [googleClientId, loginWithGoogle, navigate, returnUrl]);

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
                disabled={isSubmitting || isGoogleSubmitting}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="login-password">Password</label>
                <Link
                  to="/forgot-password"
                  style={{ fontSize: '13px', color: 'var(--ink)', textDecoration: 'underline' }}
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="login-password"
                type="password"
                className="form-control"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting || isGoogleSubmitting}
              />
            </div>

            <button
              type="submit"
              className="btn red"
              disabled={isSubmitting || isGoogleSubmitting || !email || !password}
              style={{ width: '100%', marginTop: 'var(--space-2)' }}
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {googleClientId && (
            <div style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 'var(--space-3) 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--sand)' }} />
                <span className="soft" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OR</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--sand)' }} />
              </div>
              <div
                ref={googleBtnContainerRef}
                style={{ display: 'flex', justifyContent: 'center', minHeight: '44px' }}
                aria-label="Continue with Google"
              >
                {isGoogleSubmitting && (
                  <span className="soft" style={{ fontSize: '13px' }}>Signing in with Google…</span>
                )}
              </div>
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
