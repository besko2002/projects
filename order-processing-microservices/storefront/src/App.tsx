import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { setUnauthorizedHandler } from './api/client';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { CatalogPage } from './pages/CatalogPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { PaymentCancelPage } from './pages/PaymentCancelPage';
import { PaymentSuccessPage } from './pages/PaymentSuccessPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { RegisterPage } from './pages/RegisterPage';
import { SignInPage } from './pages/SignInPage';
import { AuthProvider } from './state/AuthProvider';
import { CartProvider } from './state/CartProvider';
import { useAuth } from './state/auth';
import { signInPath } from './utils/url';

/**
 * Turns a rejected token into a sign-out and a sign-in redirect that remembers where the customer
 * was. Registered once, inside the router, because it needs both auth state and navigation.
 */
function SessionExpiryRedirect() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Re-registered on navigation so the captured return path is always the page the customer
    // was on when the session expired.
    const returnTo = signInPath(`${location.pathname}${location.search}`);
    setUnauthorizedHandler(() => {
      signOut();
      navigate(returnTo, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [location, navigate, signOut]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <SessionExpiryRedirect />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<CatalogPage />} />
            <Route path="products/:id" element={<ProductDetailPage />} />
            <Route path="cart" element={<CartPage />} />
            <Route
              path="checkout"
              element={
                <ProtectedRoute>
                  <CheckoutPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="payment/success"
              element={
                <ProtectedRoute>
                  <PaymentSuccessPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="payment/cancel"
              element={
                <ProtectedRoute>
                  <PaymentCancelPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="orders"
              element={
                <ProtectedRoute>
                  <OrdersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="orders/:id"
              element={
                <ProtectedRoute>
                  <OrderDetailPage />
                </ProtectedRoute>
              }
            />
            <Route path="signin" element={<SignInPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </CartProvider>
    </AuthProvider>
  );
}
