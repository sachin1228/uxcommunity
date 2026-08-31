/**
 * Sends and receives typing presence for a single chat room.
 * Uses Cloudflare Realtime (chat room) instead of Supabase Broadcast.
 * Event: typing  Payload: { user_id, name, typing: boolean, ts }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { useAuth } from '@/context/AuthContext';

interface TypingEntry {
  user_id: string;
  name: string;
  ts: number;
}

const TYPING_EXPIRY_MS = 3500;
const TYPING_DEBOUNCE_MS = 1000;

export function useTypingPresence(communityId: string) {
  const { user } = useAuth();
  const [typists, setTypists] = useState<TypingEntry[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const expireTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!user?.id) return;

    const room = realtimeRooms.chat(communityId);

    realtimeClient.init({ id: user.id, name: user.name ?? null, avatar: null });

    const unsubscribes: Array<() => void> = [];
    unsubscribes.push(realtimeClient.subscribe(room));

    const unsub = realtimeClient.on(room, 'typing', (data) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      const senderId = typeof payload?.user_id === 'string' ? payload.user_id : '';
      const name = typeof payload?.name === 'string' ? payload.name : 'Someone';
      const isTyping = payload?.typing === true;
      const ts = typeof payload?.ts === 'number' ? payload.ts : Date.now();

      if (!senderId || senderId === user.id) return;

      setTypists((prev) => {
        if (isTyping) {
          return [...prev.filter((e) => e.user_id !== senderId), { user_id: senderId, name, ts }];
        }
        return prev.filter((e) => e.user_id !== senderId);
      });

      clearTimeout(expireTimers.current[senderId]);
      if (isTyping) {
        expireTimers.current[senderId] = setTimeout(() => {
          setTypists((prev) => prev.filter((e) => e.user_id !== senderId));
        }, TYPING_EXPIRY_MS);
      }
    });

    unsubRef.current = unsub;

    return () => {
      unsub();
      unsubscribes.forEach((u) => u());
      unsubRef.current = null;
      Object.values(expireTimers.current).forEach(clearTimeout);
    };
  }, [communityId, user?.id, user?.name]);

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!user) return;
      const room = realtimeRooms.chat(communityId);
      realtimeClient.publish(room, 'typing', {
        user_id: user.id,
        name: user.name,
        typing: isTyping,
        ts: Date.now(),
      });
    },
    [user, communityId]
  );

  /** Call on every keystroke. Debounces stop-typing automatically. */
  const onInputChange = useCallback(
    (text: string) => {
      const hasText = text.length > 0;

      if (hasText && !isTypingRef.current) {
        isTypingRef.current = true;
        sendTyping(true);
      }

      // Reset the stop timer on every keystroke
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => {
        isTypingRef.current = false;
        sendTyping(false);
      }, TYPING_DEBOUNCE_MS);

      if (!hasText) {
        isTypingRef.current = false;
        sendTyping(false);
      }
    },
    [sendTyping]
  );

  const stopTyping = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendTyping(false);
    }
  }, [sendTyping]);

  const typingLabel = (() => {
    const active = typists.filter((e) => Date.now() - e.ts < TYPING_EXPIRY_MS);
    if (active.length === 0) return null;
    if (active.length === 1) return `${active[0].name} is typing…`;
    if (active.length === 2) return `${active[0].name} & ${active[1].name} are typing…`;
    return 'Several people are typing…';
  })();

  return { typingLabel, onInputChange, stopTyping };
}
