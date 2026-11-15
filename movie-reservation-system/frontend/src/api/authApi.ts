import { request, setToken } from './client';
import type { AuthResponse, UserDto } from '../types/auth';

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface GoogleAuthPayload {
  idToken: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  newPassword: string;
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setToken(res.accessToken);
  return res;
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setToken(res.accessToken);
  return res;
}

export async function loginWithGoogle(payload: GoogleAuthPayload): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setToken(res.accessToken);
  return res;
}

export async function forgotPassword(payload: ForgotPasswordPayload): Promise<{ message: string }> {
  return request<{ message: string }>('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resetPassword(payload: ResetPasswordPayload): Promise<{ message: string }> {
  return request<{ message: string }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    setToken(null);
  }
}

export async function getMe(): Promise<UserDto> {
  return request<UserDto>('/api/users/me');
}
