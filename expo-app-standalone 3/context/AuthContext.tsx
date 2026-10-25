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
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, login as apiLogin, logout as apiLogout, User } from '@/lib/auth';
import {
  clearSession,
  getStoredSession,
  peekSessionGeneration,
  peekSessionToken,
  subscribeUnauthorized,
} from '@/lib/api';
import {
  AUTH_USER_STORAGE_KEY,
  parseAuthSnapshot,
  serializeAuthSnapshot,
} from '@/lib/authSnapshot';
import { resolveSessionRestore, type SessionProbe } from '@/lib/authRestore';
import { chatCache } from '@/lib/chatCacheStore';
import { activateOfflineChat } from '@/lib/offline/engine';
import {
  clearCommunitiesSnapshot,
  peekCommunitiesSnapshot,
  seedCommunitiesSnapshotFromDisk,
  setCommunitiesActiveUser,
} from '@/lib/communities';
import {
  clearDmConversationsCache,
  peekDmConversations,
  seedDmConversationsFromDisk,
  setDmConversationsActiveUser,
} from '@/lib/dmConversationsCache';
import { queryClient } from '@/lib/queryClient';
import { activateScreenDataSession, clearScreenDataForUser } from '@/lib/screenDataCacheStore';
import { resetReadManager } from '@/lib/readManager';
import { resetRealtimeSession } from '@/lib/realtime';
import { resetPushRegistrationState, unregisterStoredPushTokenAsync } from '@/lib/push';
import {
  clearMemberScopedState,
  createSessionEpochClock,
  createSignOutCoordinator,
  isUnauthorizedForCurrentSession,
  performLogout,
  type MemberStateClearSteps,
} from '@/lib/sessionLifecycle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: User | null;
  /** Changes on login, logout, or an expired-session teardown. */
  sessionEpoch: number;
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
  const [sessionEpoch, setSessionEpoch] = useState(0);
  /** Identity the realtime client was last told about (null = none). */
  const realtimeUserIdRef = useRef<string | null>(null);
  const userRef = useRef<User | null>(null);
  const loginInFlightRef = useRef(false);
  const logoutInFlightRef = useRef<Promise<void> | null>(null);
  /** Invalidates validation work that belongs to a replaced session. */
  const sessionClock = useRef(createSessionEpochClock()).current;

  const isAdmin = user?.role === 'admin';

  /**
   * Every identity change goes through here, so the refs, the chat-cache
   * owner and React state can never disagree inside the same tick.
   */
  const applyUser = useCallback((next: User | null) => {
    userRef.current = next;
    realtimeUserIdRef.current = next?.id ?? null;
    activateScreenDataSession(next?.id ?? null, sessionClock.current());
    chatCache.activateUser(next?.id ?? null);
    // One SQLite offline store + outbox per member. Suspending (null) keeps
    // the previous account's unsent queue on disk, scoped to its own database,
    // but stops every worker so nothing can be transmitted as the new member.
    void activateOfflineChat(next?.id ?? null);
    setCommunitiesActiveUser(next?.id ?? null);
    setDmConversationsActiveUser(next?.id ?? null);
    setUser(next);
  }, [sessionClock]);

  /**
   * The epoch/owner a teardown belongs to. A delayed storage clear must not
   * touch the next session: every step checks this before acting, and the
   * chat cache clear is scoped to the member being signed out.
   */
  const cleanupEpochRef = useRef(0);
  const cleanupUserIdRef = useRef<string | null>(null);
  /**
   * A per-operation clear for an identity switch. It owns its epoch and user
   * id, so concurrent cleanup work cannot overwrite another operation's guard
   * through shared refs.
   */
  const makeClearSteps = useCallback(
    (epoch: number, userId: string | null): MemberStateClearSteps => {
      const isCurrent = () => sessionClock.isCurrent(epoch);
      return {
        clearQueries: () => {
          if (isCurrent()) queryClient.clear();
        },
        clearLists: () => {
          if (!isCurrent()) return;
          clearCommunitiesSnapshot();
          clearDmConversationsCache();
        },
        resetReads: () => {
          if (isCurrent()) resetReadManager();
        },
        clearSnapshot: async () => {
          if (isCurrent()) await AsyncStorage.removeItem(AUTH_USER_STORAGE_KEY);
        },
        clearCaches: async () => {
          if (isCurrent()) {
            await Promise.allSettled([
              chatCache.clearAll(userId),
              clearScreenDataForUser(userId),
            ]);
          }
        },
      };
    },
    [sessionClock],
  );

  // The sign-out coordinator and explicit logout are single-flight, so one
  // ref pair is enough for their delayed storage work.
  const clearSteps = useMemo<MemberStateClearSteps>(() => {
    const isCurrent = () => sessionClock.isCurrent(cleanupEpochRef.current);
    return {
      clearQueries: () => {
        if (isCurrent()) queryClient.clear();
      },
      clearLists: () => {
        if (!isCurrent()) return;
        clearCommunitiesSnapshot();
        clearDmConversationsCache();
      },
      resetReads: () => {
        if (isCurrent()) resetReadManager();
      },
      clearSnapshot: async () => {
        if (isCurrent()) await AsyncStorage.removeItem(AUTH_USER_STORAGE_KEY);
      },
      clearCaches: async () => {
        if (isCurrent()) {
          await Promise.allSettled([
            chatCache.clearAll(cleanupUserIdRef.current),
            clearScreenDataForUser(cleanupUserIdRef.current),
          ]);
        }
      },
    };
  }, [sessionClock]);

  const [signOut] = useState(() =>
    createSignOutCoordinator({
      invalidateSession: () => {
        cleanupUserIdRef.current = userRef.current?.id ?? null;
        cleanupEpochRef.current = sessionClock.advance();
        setSessionEpoch(cleanupEpochRef.current);
      },
      resetRealtime: resetRealtimeSession,
      markSignedOut: () => applyUser(null),
      clearSession,
      ...clearSteps,
    }),
  );

  const clearAndSignOut = useCallback(() => signOut.signOut(), [signOut]);

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

  const refresh = useCallback(async () => {
    const epoch = sessionClock.current();
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
    if (!sessionClock.isCurrent(epoch)) return;

    const previous = userRef.current;
    const decision = resolveSessionRestore(previous, probe);
    if (decision.clearMemberState) {
      await clearAndSignOut();
      return;
    }
    if (!decision.user) return;

    if (previous?.id !== decision.user.id) {
      // A different account now owns the cookie: in-memory list/query caches
      // still hold the previous member's rows. The epoch/owner guards keep a
      // delayed clear from touching the identity that wins the race.
      await clearMemberScopedState(makeClearSteps(epoch, previous?.id ?? null));
      if (!sessionClock.isCurrent(epoch)) return;
      resetRealtimeSession();
    }
    applyUser(decision.user);
    if (decision.persistUser) await persistUser(decision.user);
  }, [applyUser, clearAndSignOut, makeClearSteps, sessionClock]);

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
        applyUser(cached);
        // The shell can render now; the request below only reconciles it.
        setIsLoading(false);
      }

      const epoch = sessionClock.current();
      try {
        let probe: SessionProbe;
        try {
          const me = await getMe();
          probe = me ? { kind: 'user', user: me } : { kind: 'no-session' };
        } catch (error) {
          probe = isUnauthorizedError(error) ? { kind: 'unauthorized' } : { kind: 'offline' };
        }
        // A sign-out (or a different sign-in) superseded this validation.
        if (!active || !sessionClock.isCurrent(epoch)) return;

        const decision = resolveSessionRestore(cached, probe);
        if (decision.clearMemberState) {
          await clearAndSignOut();
        } else if (decision.user) {
          if (cached && decision.user.id !== cached.id) {
            // The cookie now belongs to another member than the snapshot; the
            // new session stays, only the previous member's caches go.
            await clearMemberScopedState(makeClearSteps(epoch, cached.id));
            if (!active || !sessionClock.isCurrent(epoch)) return;
            resetRealtimeSession();
          }
          applyUser(decision.user);
          if (decision.persistUser) await persistUser(decision.user);
        } else {
          applyUser(null);
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
  }, [applyUser, clearAndSignOut, makeClearSteps, sessionClock]);

  // Any API call rejected with 401 means the cookie no longer represents a
  // session (expired, revoked, cleared elsewhere). End the local session so
  // the next screen cannot look signed-in while every request fails. A 401
  // belonging to an older cookie is ignored: it must not clear a newer login.
  useEffect(
    () =>
      subscribeUnauthorized((usedToken, usedGeneration) => {
        if (
          !userRef.current ||
          loginInFlightRef.current ||
          logoutInFlightRef.current
        ) {
          return;
        }
        if (
          !isUnauthorizedForCurrentSession(
            usedToken,
            usedGeneration,
            peekSessionToken(),
            peekSessionGeneration(),
          )
        ) {
          return;
        }
        void clearAndSignOut();
      }),
    [clearAndSignOut],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      // The sign-out screen is visible before its push detach / server logout
      // finish; a quick re-login must not overlap that clear, or the old
      // logout could wipe the new cookie.
      const pendingLogout = logoutInFlightRef.current;
      if (pendingLogout) await pendingLogout.catch(() => {});

      // A previous account's sockets can still be open (an expired session
      // never called logout), and every hook would otherwise keep sharing them.
      // They are reset only after the credentials are accepted so a failed
      // attempt does not disturb an identity that is still valid.
      const epoch = sessionClock.advance();
      setSessionEpoch(epoch);
      loginInFlightRef.current = true;
      try {
        const { user: loggedInUser } = await apiLogin(email, password);
        // A sign-out or a newer sign-in replaced this attempt while the
        // request was in flight; its identity must not win.
        if (!sessionClock.isCurrent(epoch)) return;
        if (!loggedInUser) {
          await clearAndSignOut();
          throw new Error('Your profile could not be loaded. Please try again.');
        }

        resetRealtimeSession();
        resetPushRegistrationState();
        const previousId = userRef.current?.id ?? null;
        if (previousId && previousId !== loggedInUser.id) {
          // Account switch without an explicit sign-out (e.g. an expired
          // session): the previous member's local windows must not leak.
          await clearMemberScopedState(makeClearSteps(epoch, previousId));
          if (!sessionClock.isCurrent(epoch)) return;
        }
        applyUser(loggedInUser);
        await persistUser(loggedInUser);
      } finally {
        loginInFlightRef.current = false;
      }
    },
    [applyUser, clearAndSignOut, makeClearSteps, sessionClock],
  );

  const logout = useCallback(() => {
    if (logoutInFlightRef.current) return logoutInFlightRef.current;

    const run = performLogout({
      invalidateSession: () => {
        cleanupUserIdRef.current = userRef.current?.id ?? null;
        cleanupEpochRef.current = sessionClock.advance();
        setSessionEpoch(cleanupEpochRef.current);
      },
      resetRealtime: resetRealtimeSession,
      markSignedOut: () => applyUser(null),
      unregisterPush: () =>
        unregisterStoredPushTokenAsync({
          shouldClear: () => sessionClock.isCurrent(cleanupEpochRef.current),
        }),
      logoutRequest: apiLogout,
      clearSession,
      clearMemberState: () => clearMemberScopedState(clearSteps),
    }).finally(() => {
      if (logoutInFlightRef.current === run) logoutInFlightRef.current = null;
    });

    logoutInFlightRef.current = run;
    return run;
  }, [applyUser, clearSteps, sessionClock]);

  return (
    <AuthContext.Provider
      value={{ user, sessionEpoch, isLoading, isAdmin, login, logout, refresh }}
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
