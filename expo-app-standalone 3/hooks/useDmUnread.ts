/**
 * The Messages badge — conversations with unread peer messages (a people
 * count, never a message sum), kept current over the `dm:${userId}` room.
 *
 * While a thread is open the screen registers it with `setDmActiveConversation`
 * so a `dm-message` for that conversation never bumps the badge: the thread is
 * marking its own reads, and recounting mid-read would flash a count the
 * member cannot see the source of.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useDmUnread(): number {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [count, setCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      setCount(await getDmUnread());
    } catch {
      // Keep the previous count; the next event or foreground retries.
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }

    void fetchCount();

    realtimeClient.init({ id: userId, name: user?.name ?? null, avatar: null });
    const room = realtimeRooms.dm(userId);
    realtimeClient.connect(room);

    const scheduleRefetch = (conversationId: unknown) => {
      if (typeof conversationId === 'string' && conversationId === activeConversationId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void fetchCount();
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
      if (next === 'active') void fetchCount();
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
