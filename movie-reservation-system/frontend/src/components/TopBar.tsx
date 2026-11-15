import React, { useContext, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { AuthContext } from '../context/useAuth';
import { DemoBanner } from './DemoBanner';

interface TopBarProps {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  step?: 1 | 2 | 3 | 4;
}

export function TopBar({ searchQuery, onSearchChange, step }: TopBarProps): React.JSX.Element {
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const demoStatus = auth?.demoStatus ?? null;
  const loginDemo = auth?.loginDemo ?? (async () => {});
  const logout = auth?.logout ?? (async () => {});
  const navigate = useNavigate();
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Ignored
    }
    navigate('/');
  };

  const handleTryDemo = async () => {
    setIsDemoLoading(true);
    try {
      await loginDemo();
    } catch {
      // Ignored - error displayed in banner or page
    } finally {
      setIsDemoLoading(false);
    }
  };

  return (
    <>
      <DemoBanner />
      <header className="top top-bar" role="banner">
        <Link to="/" className="sign" aria-label="CineBook Home">
        CINEBOOK
      </Link>

      {step ? (
        <div className="steps" role="navigation" aria-label="Booking steps">
          <span className={step > 1 ? 'done' : step === 1 ? 'cur' : 'todo'}>
            <i>{step > 1 ? '✓' : '1'}</i>
            Showtime
          </span>
          <span className="line" aria-hidden="true" />
          <span className={step > 2 ? 'done' : step === 2 ? 'cur' : 'todo'}>
            <i>{step > 2 ? '✓' : '2'}</i>
            Seats
          </span>
          <span className="line" aria-hidden="true" />
          <span className={step > 3 ? 'done' : step === 3 ? 'cur' : 'todo'}>
            <i>{step > 3 ? '✓' : '3'}</i>
            Payment
          </span>
          <span className="line" aria-hidden="true" />
          <span className={step === 4 ? 'cur' : 'todo'}>
            <i>4</i>
            Ticket
          </span>
        </div>
      ) : (
        <>
          <nav className="nav" aria-label="Main Navigation">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'on' : '')}
            >
              Now showing
            </NavLink>
            <NavLink
              to="/tickets"
              className={({ isActive }) => (isActive ? 'on' : '')}
            >
              My tickets
            </NavLink>
          </nav>

          {onSearchChange && (
            <div className="top-search" role="search">
              <input
                type="search"
                placeholder="Search movies..."
                value={searchQuery ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                aria-label="Search movies"
              />
            </div>
          )}
        </>
      )}

      <div className="user">
        {user ? (
          <>
            <span className="user-name">{user.name}</span>
            <button
              type="button"
              className="btn-out"
              onClick={handleLogout}
              aria-label="Sign out of CineBook"
            >
              Sign out
            </button>
          </>
        ) : (
          <div className="guest-nav">
            {demoStatus?.enabled && (
              <button
                type="button"
                className="btn-out btn-try-demo"
                onClick={handleTryDemo}
                disabled={isDemoLoading}
                aria-label="Try demo session"
              >
                {isDemoLoading ? 'Starting…' : '⚡ Try demo'}
              </button>
            )}
            <Link to="/login" className="btn-out">
              Sign in
            </Link>
            <Link to="/register" className="btn-out btn-register">
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
    </>
  );
}
