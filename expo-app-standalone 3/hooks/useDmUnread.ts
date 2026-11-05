/**
 * The Messages badge — conversations with unread peer messages (a people
 * count, never a message sum), kept current over the `dm:${userId}` room.
 *
 * While a thread is open the screen registers it with `setDmActiveConversation`
 * so a `dm-message` for that conversation never bumps the badge: the thread is
 * marking its own reads, and recounting mid-read would flash a count the
 * member cannot see the source of.
 *
 * The count itself lives in a shared module store: every tab header mounts its
 * own copy of this hook, and they used to fetch/heal the same number
 * independently. One in-flight request and one short freshness window now back
 * them all, and a change from any source repaints every badge from the same
 * snapshot.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { getDmUnread } from '@/lib/dmApi';

/** The conversation currently on screen, if any (module-level: one at a time). */
let activeConversationId: string | null = null;

export function setDmActiveConversation(conversationId: string | null): void {
  activeConversationId = conversationId;
}

/**
 * Read markers changed elsewhere on this device (a thread marked its reads) —
 * every mounted badge re-reads the count so the envelope clears without
 * waiting for the next realtime event.
 */
const changedListeners = new Set<() => void>();

export function signalDmListChanged(): void {
  changedListeners.forEach((listener) => listener());
}

const REFETCH_DEBOUNCE_MS = 600;
/** Tab headers mount one after another; a minute-old count is already live. */
const FRESH_MS = 30_000;

let sharedUserId: string | null = null;
let sharedCount = 0;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
/** Only the newest read may publish — see refreshShared. */
let fetchSeq = 0;
/** Conversations this device already cleared optimistically (user:conversation). */
const optimisticallyRead = new Set<string>();
const badgeListeners = new Set<() => void>();

function countFor(userId: string | null): number {
  return userId !== null && sharedUserId === userId ? sharedCount : 0;
}

function publish(userId: string, count: number, fromServer = false): void {
  if (sharedUserId !== userId) {
    sharedUserId = userId;
    sharedCount = count;
    optimisticallyRead.clear();
  } else {
    sharedCount = count;
  }
  // A server count is authoritative; a later open may clear its row again.
  if (fromServer) optimisticallyRead.clear();
  fetchedAt = Date.now();
  badgeListeners.forEach((listener) => listener());
}

/**
 * Opening a conversation clears its contribution to the badge now, before the
 * read PATCH's acknowledgement round trip. The follow-up server read replaces
 * this number with the truth.
 */
export function clearDmUnreadLocally(conversationId: string, hadUnread: boolean): void {
  if (!hadUnread || !sharedUserId) return;
  const key = `${sharedUserId}:${conversationId}`;
  if (optimisticallyRead.has(key)) return;
  optimisticallyRead.add(key);
  publish(sharedUserId, Math.max(0, sharedCount - 1));
}

function refreshShared(userId: string, force = false): Promise<void> {
  if (!force) {
    if (inFlight) return inFlight;
    if (sharedUserId === userId && Date.now() - fetchedAt < FRESH_MS) {
      return Promise.resolve();
    }
  }
  // A forced read is a "something just changed" signal (a conversation was
  // read, the app returned). It must not be answered by a request that was
  // already in flight before that change — that response can still carry the
  // pre-read count and would leave the badge stuck with nothing to refresh it.
  const seq = ++fetchSeq;
  const request = getDmUnread()
    .then((count) => {
      if (seq === fetchSeq) publish(userId, count, true);
    })
    .catch(() => {
      // Keep the previous count; the next event or foreground retries.
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

export function useDmUnread(): number {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const count = useSyncExternalStore(
    (listener) => {
      badgeListeners.add(listener);
      return () => {
        badgeListeners.delete(listener);
      };
    },
    () => countFor(userId),
    () => countFor(userId),
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCount = useCallback(
    (force = false) => {
      if (!userId) return Promise.resolve();
      return refreshShared(userId, force);
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;

    void fetchCount();

    realtimeClient.init({ id: userId, name: user?.name ?? null, avatar: null });
    const room = realtimeRooms.dm(userId);
    realtimeClient.connect(room);

    const scheduleRefetch = (conversationId: unknown) => {
      if (typeof conversationId === 'string' && conversationId === activeConversationId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void fetchCount(true);
      }, REFETCH_DEBOUNCE_MS);
    };

    const unsubscribes: Array<() => void> = [];
    unsubscribes.push(
      realtimeClient.on(room, 'dm-message', (data) => {
        const payload = data as { conversation_id?: string } | null;
        scheduleRefetch(payload?.conversation_id);
      }),
    );
    unsubscribes.push(
      realtimeClient.on(room, 'dm-request-update', (data) => {
        const payload = data as { conversation_id?: string } | null;
        scheduleRefetch(payload?.conversation_id);
      }),
    );

    // A thread on this device just marked reads — recount promptly.
    const onLocalChange = () => scheduleRefetch(undefined);
    changedListeners.add(onLocalChange);
    unsubscribes.push(() => changedListeners.delete(onLocalChange));

    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void fetchCount(true);
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      appStateSub.remove();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [userId, user?.name, fetchCount]);

  return count;
}
