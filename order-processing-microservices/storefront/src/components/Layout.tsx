import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../state/auth';
import { useCart } from '../state/cart';

export function Layout() {
  const { user, signOut } = useAuth();
  const { totalQuantity } = useCart();
  const navigate = useNavigate();

  const handleSignOut = () => {
    signOut();
    navigate('/');
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container site-header__inner">
          <Link to="/" className="brand">
            <span className="brand__mark" aria-hidden="true" />
            Outline Store
          </Link>
          <nav className="site-nav" aria-label="Primary">
            <NavLink to="/" end>
              Catalog
            </NavLink>
            <NavLink to="/cart">Cart{totalQuantity > 0 ? ` (${totalQuantity})` : ''}</NavLink>
            {user && <NavLink to="/orders">My orders</NavLink>}
          </nav>
          <div className="site-header__user">
            {user ? (
              <>
                <span className="muted">Signed in as {user.name}</span>
                <button type="button" className="btn btn--small" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink className="btn btn--small" to="/signin">
                  Sign in
                </NavLink>
                <NavLink className="btn btn--primary btn--small" to="/register">
                  Register
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="container">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">
          Outline Store is a portfolio demonstration. Payments run against Stripe test mode only —
          no real money moves.
        </div>
      </footer>
    </>
  );
}
