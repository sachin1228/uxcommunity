/**
 * Session state for the whole app.
 *
 * The provider is also the one place that ends the realtime session: every
 * socket, subscription, reconnect timer and cached presence entry belongs to
 * the signed-in account, so a sign-out (or a session that has gone stale) tears
 * the realtime client down before the next identity can use it. Without that, a
 * socket opened for the previous account keeps its `join` identity and its
 * subscriptions, and the next member's events ride a connection the server
 * still attributes to someone else.
 *
 * Launch order is "local first, validate after": the member's last snapshot is
 * painted immediately and `/api/auth/me` revalidates the cookie in the
 * background. The snapshot is display-only — authorization stays on the server
 * — and a rejected cookie clears it together with every member-scoped cache.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, login as apiLogin, logout as apiLogout, User } from '@/lib/auth';
import {
  clearSession,
  getStoredSession,
  subscribeUnauthorized,
} from '@/lib/api';
import {
  AUTH_USER_STORAGE_KEY,
  parseAuthSnapshot,
  serializeAuthSnapshot,
} from '@/lib/authSnapshot';
import { resolveSessionRestore, type SessionProbe } from '@/lib/authRestore';
import { chatCache } from '@/lib/chatCacheStore';
import {
  clearCommunitiesSnapshot,
  peekCommunitiesSnapshot,
  seedCommunitiesSnapshotFromDisk,
} from '@/lib/communities';
import {
  clearDmConversationsCache,
  peekDmConversations,
  seedDmConversationsFromDisk,
} from '@/lib/dmConversationsCache';
import { queryClient } from '@/lib/queryClient';
import { resetReadManager } from '@/lib/readManager';
import { resetRealtimeSession } from '@/lib/realtime';
import { resetPushRegistrationState, unregisterStoredPushTokenAsync } from '@/lib/push';

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
// Helpers
// ---------------------------------------------------------------------------

function isUnauthorizedError(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401;
}

async function persistUser(user: User | null): Promise<void> {
  try {
    const raw = user ? serializeAuthSnapshot(user) : null;
    if (raw) await AsyncStorage.setItem(AUTH_USER_STORAGE_KEY, raw);
    else await AsyncStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
    // A failed snapshot write only costs the next launch its head start.
  }
}

/** Everything tied to the signed-in identity, dropped on sign-out/expiry. */
async function clearMemberState(): Promise<void> {
  queryClient.clear();
  clearCommunitiesSnapshot();
  clearDmConversationsCache();
  resetReadManager();
  await Promise.allSettled([
    AsyncStorage.removeItem(AUTH_USER_STORAGE_KEY),
    chatCache.clearAll(),
  ]);
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
  const userRef = useRef<User | null>(null);
  const clearingRef = useRef(false);
  /**
   * Bumped by sign-in/out. A validation request that settles after the
   * session it was checking has been replaced must not resurrect it.
   */
  const sessionEpochRef = useRef(0);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    userRef.current = user;
    realtimeUserIdRef.current = user?.id ?? null;
  }, [user]);

  // Warm the two list snapshots as soon as an identity exists. Screens mount
  // on the next frame, and a notification/push deep-link can open a thread
  // before the list has ever been visited in this process.
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return undefined;
    let active = true;
    void (async () => {
      if (!peekCommunitiesSnapshot()) {
        const rows = await chatCache.loadCommunityList(userId).catch(() => null);
        if (active && rows && rows.length > 0 && !peekCommunitiesSnapshot()) {
          seedCommunitiesSnapshotFromDisk(rows);
        }
      }
      if (!peekDmConversations()) {
        const rows = await chatCache.loadDmConversationList(userId).catch(() => null);
        if (active && rows && rows.length > 0 && !peekDmConversations()) {
          seedDmConversationsFromDisk(rows);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const clearAndSignOut = useCallback(async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    sessionEpochRef.current += 1;
    try {
      resetRealtimeSession();
      await clearSession();
      await clearMemberState();
      setUser(null);
    } finally {
      clearingRef.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    let probe: SessionProbe;
    try {
      const me = await getMe();
      probe = me ? { kind: 'user', user: me } : { kind: 'no-session' };
    } catch (error) {
      // A temporary network failure is not a sign-out: the member keeps the
      // shell and the caches, and the next refresh settles the session.
      probe = isUnauthorizedError(error) ? { kind: 'unauthorized' } : { kind: 'offline' };
    }
    // Signed out (or signed in as someone else) while this was in flight.
    if (epoch !== sessionEpochRef.current) return;

    const decision = resolveSessionRestore(userRef.current, probe);
    if (decision.clearMemberState) {
      await clearAndSignOut();
      return;
    }
    if (!decision.user) return;
    if (decision.user.id !== realtimeUserIdRef.current) resetRealtimeSession();
    // A different account now owns the cookie: in-memory list/query caches
    // still hold the previous member's rows.
    if (userRef.current && decision.user.id !== userRef.current.id) {
      await clearMemberState();
    }
    setUser(decision.user);
    if (decision.persistUser) await persistUser(decision.user);
  }, [clearAndSignOut]);

  // Restore the last snapshot at once, then validate the cookie behind it.
  useEffect(() => {
    let active = true;

    (async () => {
      const token = await getStoredSession().catch(() => null);
      if (!active) return;
      if (!token) {
        setIsLoading(false);
        return;
      }

      const cached = parseAuthSnapshot(
        await AsyncStorage.getItem(AUTH_USER_STORAGE_KEY).catch(() => null),
      );
      if (cached && active) {
        realtimeUserIdRef.current = cached.id;
        setUser(cached);
        // The shell can render now; the request below only reconciles it.
        setIsLoading(false);
      }

      const epoch = sessionEpochRef.current;
      try {
        let probe: SessionProbe;
        try {
          const me = await getMe();
          probe = me ? { kind: 'user', user: me } : { kind: 'no-session' };
        } catch (error) {
          probe = isUnauthorizedError(error) ? { kind: 'unauthorized' } : { kind: 'offline' };
        }
        // A sign-out (or a different sign-in) superseded this validation.
        if (!active || epoch !== sessionEpochRef.current) return;

        const decision = resolveSessionRestore(cached, probe);
        if (decision.clearMemberState) {
          await clearAndSignOut();
        } else if (decision.user) {
          if (decision.user.id !== realtimeUserIdRef.current) resetRealtimeSession();
          if (cached && decision.user.id !== cached.id) {
            // The cookie now belongs to another member than the snapshot.
            await clearMemberState();
          }
          setUser(decision.user);
          if (decision.persistUser) await persistUser(decision.user);
        } else {
          setUser(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [clearAndSignOut]);

  // Any API call rejected with 401 means the cookie no longer represents a
  // session (expired, revoked, cleared elsewhere). End the local session so
  // the next screen cannot look signed-in while every request fails.
  useEffect(
    () =>
      subscribeUnauthorized(() => {
        if (!userRef.current) return;
        void clearAndSignOut();
      }),
    [clearAndSignOut],
  );

  const login = useCallback(async (email: string, password: string) => {
    // A previous account's sockets can still be open (an expired session never
    // called logout), and every hook would otherwise keep sharing them.
    resetRealtimeSession();
    resetPushRegistrationState();
    sessionEpochRef.current += 1;
    const { user: loggedInUser } = await apiLogin(email, password);
    if (!loggedInUser) {
      setUser(null);
      return;
    }

    const previousId = userRef.current?.id ?? null;
    if (previousId && previousId !== loggedInUser.id) {
      // Account switch without an explicit sign-out (e.g. an expired session):
      // the previous member's local windows and query cache must not leak.
      await clearMemberState();
    }
    setUser(loggedInUser);
    await persistUser(loggedInUser);
  }, []);

  const logout = useCallback(async () => {
    // Close every socket, cancel its reconnect and forget the signed-in
    // identity before anything else — a reconnect timer that outlived logout
    // would bring the previous account's realtime state back.
    resetRealtimeSession();
    sessionEpochRef.current += 1;
    // Detach this device before the session cookie is cleared, otherwise the
    // next person to sign in here keeps receiving the previous account's pushes.
    await unregisterStoredPushTokenAsync();
    await apiLogout();
    // The cached windows are the member's messages — a shared device must not
    // keep them after sign-out (the next account cannot read them anyway:
    // keys are user-scoped, but they should not linger on disk).
    await clearMemberState();
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
