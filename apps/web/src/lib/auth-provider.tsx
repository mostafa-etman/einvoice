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
import {
  getAccessToken,
  getActiveTenantId,
  getSessionHint,
  setAccessToken,
  setSessionHint,
} from '@/lib/session';
import { countUnsynced } from '@/lib/offline/draft-queue';
import { confirmLogoutIfUnsynced } from '@/lib/logout-unsynced-confirm';

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
      // HttpOnly refresh cookie is not visible to JS. Only call /auth/refresh when
      // a prior login/register left a session hint — otherwise cold open always
      // produces 401 {"message":"Missing refresh token"} in the Network tab.
      if (!getSessionHint()) {
        if (!cancelled) {
          setUser(null);
          setReady(true);
        }
        return;
      }

      try {
        const session = await authApi.refresh();
        if (!cancelled) {
          setUser(session.user);
        }
      } catch {
        if (!cancelled) {
          setSessionHint(false);
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
    const tenantId = getActiveTenantId();
    if (tenantId) {
      const unsynced = await countUnsynced(tenantId);
      if (unsynced > 0) {
        const ok = await confirmLogoutIfUnsynced(unsynced);
        if (!ok) return;
      }
    }
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
