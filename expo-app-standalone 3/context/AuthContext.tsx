/**
 * Session state for the whole app.
 *
 * Also the one place that ends the realtime session: every socket, subscription,
 * reconnect timer and cached presence entry belongs to the signed-in account, so
 * a sign-out (or a session that has gone stale) tears the realtime client down
 * before the next identity can use it. Without that, a socket opened for the
 * previous account keeps its `join` identity and its subscriptions, and the next
 * member's events ride a connection the server still attributes to someone else.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getMe, login as apiLogin, logout as apiLogout, User } from '@/lib/auth';
import { resetRealtimeSession } from '@/lib/realtime';
import { unregisterStoredPushTokenAsync } from '@/lib/push';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** Identity the realtime client was last told about (null = none). */
  const realtimeUserIdRef = useRef<string | null>(null);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    realtimeUserIdRef.current = user?.id ?? null;
  }, [user]);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      // Re-reading the same session must not disturb live sockets — only a
      // different identity (or a session that has gone) ends it.
      if (me?.id !== realtimeUserIdRef.current) resetRealtimeSession();
      setUser(me);
    } catch {
      resetRealtimeSession();
      setUser(null);
    }
  }, []);

  // Check existing session on mount
  useEffect(() => {
    (async () => {
      try {
        const me = await getMe();
        setUser(me);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // A previous account's sockets can still be open (an expired session never
    // called logout), and every hook would otherwise keep sharing them.
    resetRealtimeSession();
    const { user: loggedInUser } = await apiLogin(email, password);
    setUser(loggedInUser);
  }, []);

  const logout = useCallback(async () => {
    // Close every socket, cancel its reconnect and forget the signed-in
    // identity before anything else — a reconnect timer that outlived logout
    // would bring the previous account's realtime state back.
    resetRealtimeSession();
    // Detach this device before the session cookie is cleared, otherwise the
    // next person to sign in here keeps receiving the previous account's pushes.
    await unregisterStoredPushTokenAsync();
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAdmin, login, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
