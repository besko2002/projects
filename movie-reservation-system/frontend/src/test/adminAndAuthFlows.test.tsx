import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminGuard } from '../components/AdminGuard';
import { AuthContext } from '../context/useAuth';
import type { AuthContextValue } from '../context/useAuth';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { SignInPage } from '../pages/SignInPage';
import * as authApi from '../api/authApi';
import * as adminApi from '../api/adminApi';

vi.mock('../api/authApi');
vi.mock('../api/adminApi');

describe('AdminGuard Component', () => {
  it('redirects anonymous visitor to /login with return path', () => {
    const mockAuth: AuthContextValue = {
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter initialEntries={['/admin/movies']}>
          <Routes>
            <Route
              path="/admin/movies"
              element={
                <AdminGuard>
                  <div>Secret Staff Admin Content</div>
                </AdminGuard>
              }
            />
            <Route path="/login" element={<div>Sign In Screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.queryByText('Secret Staff Admin Content')).toBeNull();
    expect(screen.getByText('Sign In Screen')).toBeInTheDocument();
  });

  it('renders 403 Forbidden screen when authenticated user lacks ADMIN role', () => {
    const mockAuth: AuthContextValue = {
      user: {
        id: 42,
        name: 'Regular Customer',
        email: 'customer@cinebook.local',
        role: 'USER',
      },
      token: 'jwt-token',
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter initialEntries={['/admin/movies']}>
          <Routes>
            <Route
              path="/admin/movies"
              element={
                <AdminGuard>
                  <div>Secret Staff Admin Content</div>
                </AdminGuard>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.queryByText('Secret Staff Admin Content')).toBeNull();
    expect(screen.getByText('403 Forbidden')).toBeInTheDocument();
    expect(screen.getByText(/Staff Administration Only/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to Box Office/i })).toBeInTheDocument();
  });

  it('renders children when authenticated user has ADMIN role', () => {
    const mockAuth: AuthContextValue = {
      user: {
        id: 1,
        name: 'Staff Manager',
        email: 'admin@cinebook.local',
        role: 'ADMIN',
      },
      token: 'jwt-token',
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter initialEntries={['/admin/movies']}>
          <Routes>
            <Route
              path="/admin/movies"
              element={
                <AdminGuard>
                  <div>Secret Staff Admin Content</div>
                </AdminGuard>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(screen.getByText('Secret Staff Admin Content')).toBeInTheDocument();
  });
});

describe('Password Reset Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getAuthConfig).mockResolvedValue({
      googleClientId: null,
      passwordResetEnabled: true,
    });
  });

  it('ForgotPasswordPage sends forgot password request and shows feedback', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({
      message: 'If the email exists, a password reset link has been dispatched.',
    });

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/Account Email/i);
    const submitBtn = screen.getByRole('button', { name: /Send Reset Link/i });

    fireEvent.change(emailInput, { target: { value: 'alice@cinebook.local' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(authApi.forgotPassword).toHaveBeenCalledWith({ email: 'alice@cinebook.local' });
    });

    expect(await screen.findByText(/Check your inbox/i)).toBeInTheDocument();
  });

  it('ResetPasswordPage validates token and matching passwords', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({
      message: 'Your password has been successfully reset.',
    });

    render(
      <MemoryRouter initialEntries={['/reset-password?token=valid-secret-token']}>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const passInput = screen.getByLabelText(/^New Password/i);
    const confirmInput = screen.getByLabelText(/Confirm New Password/i);
    const submitBtn = screen.getByRole('button', { name: /Update password/i });

    fireEvent.change(passInput, { target: { value: 'Secret123!' } });
    fireEvent.change(confirmInput, { target: { value: 'DifferentPassword' } });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(authApi.resetPassword).not.toHaveBeenCalled();

    // Now matching password
    fireEvent.change(confirmInput, { target: { value: 'Secret123!' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(authApi.resetPassword).toHaveBeenCalledWith({
        token: 'valid-secret-token',
        newPassword: 'Secret123!',
      });
    });

    expect(await screen.findByText(/Password Reset Complete/i)).toBeInTheDocument();
  });
});

describe('SignInPage Enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getAuthConfig).mockResolvedValue({
      googleClientId: null,
      passwordResetEnabled: true,
    });
  });

  it('renders Forgot Password link', async () => {
    const mockAuth: AuthContextValue = {
      user: null,
      token: null,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={mockAuth}>
        <MemoryRouter>
          <SignInPage />
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    const forgotLink = await screen.findByRole('link', { name: /Forgot password\?/i });
    expect(forgotLink).toBeInTheDocument();
    expect(forgotLink).toHaveAttribute('href', '/forgot-password');
  });
});
