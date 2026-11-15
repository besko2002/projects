import React, { useContext } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { AuthContext } from '../context/useAuth';

interface TopBarProps {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  step?: 1 | 2 | 3 | 4;
}

export function TopBar({ searchQuery, onSearchChange, step }: TopBarProps): React.JSX.Element {
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const logout = auth?.logout ?? (async () => {});
  const notice = auth?.notice ?? null;
  const dismissNotice = auth?.dismissNotice;
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Ignored
    }
    navigate('/');
  };

  return (
    <>
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
            {user?.role === 'ADMIN' && (
              <NavLink
                to="/admin"
                className={({ isActive }) => (isActive ? 'on btn-admin-nav' : 'btn-admin-nav')}
              >
                Staff Admin
              </NavLink>
            )}
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
            {user.role === 'ADMIN' && (
              <Link to="/admin" className="btn-out btn-admin" aria-label="Admin panel">
                Admin
              </Link>
            )}
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
    {notice && (
      <aside
        className="info-banner"
        role="status"
        style={{
          margin: 'var(--space-2) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <span>{notice}</span>
        {dismissNotice && (
          <button
            type="button"
            onClick={dismissNotice}
            className="btn-out"
            style={{ padding: '2px 8px', fontSize: '12px', whiteSpace: 'nowrap' }}
            aria-label="Dismiss notice"
          >
            Dismiss
          </button>
        )}
      </aside>
    )}
  </>
  );
}
