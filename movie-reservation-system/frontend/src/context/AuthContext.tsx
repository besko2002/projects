import React, { useEffect, useState, useCallback } from 'react';
import type { UserDto } from '../types/auth';
import type { LoginPayload, RegisterPayload } from '../api/authApi';
import * as authApi from '../api/authApi';
import { ApiException, getToken, setToken, setUnauthorizedHandler } from '../api/client';
import { AuthContext } from './useAuth';

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setTokenState] = useState<string | null>(getToken());
  const [isLoading, setIsLoading] = useState<boolean>(() => !!getToken());

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await authApi.getMe();
      setUser(me);
    } catch (err) {
      if (err instanceof ApiException && (err.status === 401 || err.status === 403)) {
        setUser(null);
        setToken(null);
        setTokenState(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    setUnauthorizedHandler(() => {
      setUser(null);
      setToken(null);
      setTokenState(null);
    });

    if (getToken()) {
      authApi.getMe()
        .then((me) => {
          if (!ignore) {
            setUser(me);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (!ignore) {
            // Only clear token & session on 401/403, preserve on network or 5xx server errors
            if (err instanceof ApiException && (err.status === 401 || err.status === 403)) {
              setUser(null);
              setToken(null);
              setTokenState(null);
            }
            setIsLoading(false);
          }
        });
    }

    return () => {
      ignore = true;
    };
  }, []);

  const handleLogin = async (payload: LoginPayload) => {
    const res = await authApi.login(payload);
    setTokenState(res.accessToken);
    setUser(res.user);
  };

  const handleRegister = async (payload: RegisterPayload) => {
    const res = await authApi.register(payload);
    setTokenState(res.accessToken);
    setUser(res.user);
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Gracefully catch logout errors (P3)
    } finally {
      setUser(null);
      setToken(null);
      setTokenState(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login: handleLogin,
        register: handleRegister,
        logout: handleLogout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
