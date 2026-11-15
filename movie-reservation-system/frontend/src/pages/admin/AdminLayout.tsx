import React from 'react';
import { Link, NavLink } from 'react-router';
import { useAuth } from '../../context/useAuth';

interface AdminLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export function AdminLayout({ children, title, subtitle }: AdminLayoutProps): React.JSX.Element {
  const { user } = useAuth();

  return (
    <div className="screen screen-container" id="admin-panel">
      <header className="top top-bar" role="banner" style={{ borderBottom: '3px solid var(--mustard)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link to="/admin/movies" className="sign" aria-label="Staff Administration Console">
            CINEBOOK ADMIN
          </Link>
          <span className="stamp" style={{ background: 'var(--red)', color: '#fff', fontSize: '11px', padding: '3px 8px' }}>
            STAFF CONSOLE
          </span>
        </div>

        <nav className="nav admin-nav" aria-label="Admin Sections">
          <NavLink
            to="/admin/movies"
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            Movies
          </NavLink>
          <NavLink
            to="/admin/genres"
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            Genres
          </NavLink>
          <NavLink
            to="/admin/halls"
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            Halls
          </NavLink>
          <NavLink
            to="/admin/showtimes"
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            Showtimes
          </NavLink>
          <NavLink
            to="/admin/reports"
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            Reports
          </NavLink>
        </nav>

        <div className="user">
          <span className="user-name" style={{ fontSize: '13px' }}>{user?.name}</span>
          <Link to="/" className="btn-out" aria-label="Go to customer public box office">
            Public Site →
          </Link>
        </div>
      </header>

      <main className="wrap" style={{ padding: 'var(--space-6) var(--space-4)' }}>
        <div style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div className="kicker" style={{ color: 'var(--teal)' }}>Administration Management</div>
            <h1 style={{ margin: '4px 0 0 0', fontSize: '28px' }}>{title}</h1>
            {subtitle && <p className="soft" style={{ margin: '6px 0 0 0', fontSize: '14px' }}>{subtitle}</p>}
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
