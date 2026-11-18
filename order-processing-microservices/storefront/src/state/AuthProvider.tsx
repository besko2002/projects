import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getMe, login as loginRequest, register as registerRequest } from '../api/authApi';
import { getToken, setToken } from '../api/client';
import type { UserResponse } from '../types/api';
import { AuthContext } from './auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [restoring, setRestoring] = useState<boolean>(() => getToken() !== null);
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const userIdRef = useRef<string | null>(null);

  /**
   * @param next          the account now in effect (null after sign-out)
   * @param clearOnChange whether this is a user action that reached a different *signed-in*
   *                      identity. Restoring a session is not a change, and signing in from an
   *                      anonymous visit keeps the cart the customer filled before signing in;
   *                      only leaving an account (or replacing one with another) resets local
   *                      purchase state.
   */
  const adoptUser = useCallback(
    (next: UserResponse | null, clearOnChange: boolean) => {
      const previous = userIdRef.current;
      const nextId = next?.id ?? null;
      userIdRef.current = nextId;
      setUser(next);
      if (clearOnChange && previous !== null && previous !== nextId) {
        setIdentityEpoch((epoch) => epoch + 1);
      }
    },
    [],
  );

  // A token from a previous visit is not trusted on its own: ask /api/auth/me who it belongs to.
  // A 401 here already clears the token in the API client and notifies the session guard. When no
  // token was stored, `restoring` was initialized to false, so there is nothing to resolve.
  useEffect(() => {
    if (!getToken()) {
      return;
    }
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) adoptUser(me, false);
      })
      .catch(() => {
        if (!cancelled) adoptUser(null, false);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adoptUser]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const auth = await loginRequest({ email: email.trim(), password });
      setToken(auth.accessToken);
      adoptUser(auth.user, true);
      return auth.user;
    },
    [adoptUser],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const auth = await registerRequest({ name: name.trim(), email: email.trim(), password });
      setToken(auth.accessToken);
      adoptUser(auth.user, true);
      return auth.user;
    },
    [adoptUser],
  );

  const signOut = useCallback(() => {
    setToken(null);
    adoptUser(null, true);
  }, [adoptUser]);

  const value = useMemo(
    () => ({ user, restoring, identityEpoch, signIn, register, signOut }),
    [user, restoring, identityEpoch, signIn, register, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
