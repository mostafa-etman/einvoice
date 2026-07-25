'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '@/lib/api/auth';
import type { AuthUser } from '@/lib/api/auth';
import { getAccessToken, setAccessToken } from '@/lib/session';

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  login: typeof authApi.login;
  register: typeof authApi.register;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await authApi.refresh();
        if (!cancelled) {
          setUser(session.user);
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const session = await authApi.login(input);
    setUser(session.user);
    return session;
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      const session = await authApi.register(input);
      setUser(session.user);
      return session;
    },
    [],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout }),
    [user, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}

export function useIsAuthenticated(): boolean {
  const { user, ready } = useAuth();
  return ready && user !== null;
}

export function hasAccessToken(): boolean {
  return getAccessToken() !== null;
}
