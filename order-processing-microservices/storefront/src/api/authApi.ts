import type { AuthResponse, UserResponse } from '../types/api';
import { request } from './client';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

/** POST /api/auth/login → 200 AuthResponse; wrong credentials → 401. */
export function login(payload: LoginPayload): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** POST /api/auth/register → 201 AuthResponse; duplicate email → 409; validation → 400 fieldErrors. */
export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** GET /api/auth/me → the account the bearer token was issued for. */
export function getMe(): Promise<UserResponse> {
  return request<UserResponse>('/api/auth/me');
}
