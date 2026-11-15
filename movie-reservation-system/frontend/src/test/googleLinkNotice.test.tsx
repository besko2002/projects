import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../context/AuthContext';
import { useAuth } from '../context/useAuth';
import { TopBar } from '../components/TopBar';
import * as authApi from '../api/authApi';
import { setToken } from '../api/client';

vi.mock('../api/authApi');

const user = { id: 7, name: 'Linked Patron', email: 'linked@example.com', role: 'USER' as const };

function GoogleTrigger() {
  const { loginWithGoogle } = useAuth();
  return (
    <button type="button" onClick={() => void loginWithGoogle?.('google-id-token')}>
      Simulate Google
    </button>
  );
}

function renderShell() {
  render(
    <AuthProvider>
      <MemoryRouter>
        <TopBar />
        <GoogleTrigger />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('CB-25: Google linking that replaces a password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setToken(null);
    vi.mocked(authApi.getMe).mockResolvedValue(user);
  });

  it('tells the user their password was cleared and how to set one again, until dismissed', async () => {
    vi.mocked(authApi.loginWithGoogle).mockResolvedValue({
      accessToken: 'jwt-after-link',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user,
      notice: 'Your CineBook account was linked with Google. For security, your previous password was cleared '
        + "and other active sessions were logged out. You can sign in with Google or use 'Forgot password' "
        + 'anytime if you need to set a password again.',
    });
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate Google' }));

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/previous password was cleared/i);
    expect(banner).toHaveTextContent(/Forgot password/i);
    expect(authApi.loginWithGoogle).toHaveBeenCalledWith({ idToken: 'google-id-token' });

    fireEvent.click(screen.getByRole('button', { name: /Dismiss notice/i }));
    await waitFor(() => expect(screen.queryByText(/previous password was cleared/i)).toBeNull());
  });
});
