import { createContext, useContext } from 'react';
import type { UserDto } from '../types/auth';
import type { DemoStatus } from '../types/demo';
import type { LoginPayload, RegisterPayload } from '../api/authApi';

export interface AuthContextValue {
  user: UserDto | null;
  token: string | null;
  isLoading: boolean;
  demoStatus?: DemoStatus | null;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  loginDemo?: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  user: null,
  token: null,
  isLoading: false,
  demoStatus: null,
  login: async () => {},
  register: async () => {},
  loginDemo: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  return ctx ?? DEFAULT_AUTH_CONTEXT;
}
