import { request, setToken } from './client';
import type { AuthResponse, UserDto } from '../types/auth';
import type { DemoStatus } from '../types/demo';

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
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

export async function getDemoStatus(): Promise<DemoStatus> {
  try {
    return await request<DemoStatus>('/api/demo/status');
  } catch {
    return { enabled: false, banner: null, stripeMode: null };
  }
}

export async function createDemoSession(): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/api/demo/session', {
    method: 'POST',
  });
  setToken(res.accessToken);
  return res;
}
