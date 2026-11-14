import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../context/useAuth';

interface TopBarProps {
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export function TopBar({ searchQuery, onSearchChange }: TopBarProps): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="top-bar" role="banner">
      <Link to="/" className="logo" aria-label="CineBook Home">
        <div className="logo-mark" aria-hidden="true">▶</div>
        <span>CineBook</span>
      </Link>

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

      <div className="top-search" role="search">
        <span aria-hidden="true" style={{ fontSize: '16px' }}>⌕</span>
        <input
          type="search"
          placeholder="Search movies..."
          value={searchQuery ?? ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          aria-label="Search movies"
        />
      </div>

      <div className="user-area">
        {user ? (
          <>
            <div className="avatar" title={user.email} aria-hidden="true">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontWeight: 700 }}>{user.name}</span>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={handleLogout}
              aria-label="Sign out of CineBook"
            >
              Sign out
            </button>
          </>
        ) : (
          <div className="btn-row">
            <Link to="/login" className="btn btn-ghost btn-compact">
              Sign in
            </Link>
            <Link to="/register" className="btn btn-primary btn-compact">
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
