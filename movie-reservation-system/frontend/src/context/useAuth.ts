import { createContext, useContext } from 'react';
import type { UserDto } from '../types/auth';
import type { LoginPayload, RegisterPayload } from '../api/authApi';

export interface AuthContextValue {
  user: UserDto | null;
  token: string | null;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  loginWithGoogle?: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  notice?: string | null;
  dismissNotice?: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  user: null,
  token: null,
  isLoading: false,
  login: async () => {},
  register: async () => {},
  loginWithGoogle: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
  notice: null,
  dismissNotice: () => {},
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  return ctx ?? DEFAULT_AUTH_CONTEXT;
}
