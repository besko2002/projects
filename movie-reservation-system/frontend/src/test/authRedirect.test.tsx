import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SignInPage } from '../pages/SignInPage';
import { AuthProvider } from '../context/AuthContext';
import * as authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('Auth Redirect Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submitting login redirects to the return URL query parameter', async () => {
    const user = userEvent.setup();

    vi.mocked(authApi.login).mockResolvedValue({
      accessToken: 'jwt-xyz',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', role: 'USER' },
    });

    render(
      <MemoryRouter initialEntries={['/login?return=/book/42']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<SignInPage />} />
            <Route path="/book/42" element={<div>Destination Seat Map for Schedule 42</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitBtn = screen.getByRole('button', { name: /^sign in$/i });

    await user.type(emailInput, 'ada@example.com');
    await user.type(passwordInput, 'Str0ng@Pass1');
    await user.click(submitBtn);

    expect(authApi.login).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Str0ng@Pass1',
    });

    expect(await screen.findByText(/destination seat map for schedule 42/i)).toBeInTheDocument();
  });
});
