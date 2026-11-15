import React from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { MovieDetailPage } from './pages/MovieDetailPage';
import { SeatSelectionPage } from './pages/SeatSelectionPage';
import { PaymentSuccessPage } from './pages/PaymentSuccessPage';
import { PaymentCancelPage } from './pages/PaymentCancelPage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { SignInPage } from './pages/SignInPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AdminGuard } from './components/AdminGuard';
import { AdminMoviesPage } from './pages/admin/AdminMoviesPage';
import { AdminGenresPage } from './pages/admin/AdminGenresPage';
import { AdminHallsPage } from './pages/admin/AdminHallsPage';
import { AdminShowtimesPage } from './pages/admin/AdminShowtimesPage';
import { AdminReportsPage } from './pages/admin/AdminReportsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/movie/:id" element={<MovieDetailPage />} />
      <Route path="/book/:scheduleId" element={<SeatSelectionPage />} />
      <Route path="/payment/success" element={<PaymentSuccessPage />} />
      <Route path="/payment/cancel" element={<PaymentCancelPage />} />
      <Route path="/tickets" element={<MyTicketsPage />} />
      <Route path="/login" element={<SignInPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Staff Admin Routes */}
      <Route path="/admin" element={<Navigate to="/admin/movies" replace />} />
      <Route
        path="/admin/movies"
        element={
          <AdminGuard>
            <AdminMoviesPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/genres"
        element={
          <AdminGuard>
            <AdminGenresPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/halls"
        element={
          <AdminGuard>
            <AdminHallsPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/showtimes"
        element={
          <AdminGuard>
            <AdminShowtimesPage />
          </AdminGuard>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <AdminGuard>
            <AdminReportsPage />
          </AdminGuard>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
