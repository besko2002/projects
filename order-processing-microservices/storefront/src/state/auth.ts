import { createContext, useContext } from 'react';
import type { UserResponse } from '../types/api';

export interface AuthContextValue {
  /** The signed-in account, or null when anonymous. */
  user: UserResponse | null;
  /** True while a token persisted from a previous visit is being checked against the API. */
  restoring: boolean;
  /**
   * Increments when the signed-in account changes (sign-out, or switching accounts). Local
   * purchase state (cart, checkout attempt) must reset then; order and payment data is always
   * fetched per account and never cached across identities.
   */
  identityEpoch: number;
  signIn(email: string, password: string): Promise<UserResponse>;
  register(name: string, email: string, password: string): Promise<UserResponse>;
  signOut(): void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
