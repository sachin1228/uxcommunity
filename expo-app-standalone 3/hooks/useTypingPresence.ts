/**
 * Sends and receives typing presence for a single chat room — a React Native
 * port of the web `useTypingPresence` so the indicator behaves identically:
 *
 *   • the local user broadcasts "typing" at most once per TYPING_THROTTLE_MS
 *   • typing stops after TYPING_IDLE_MS without a keystroke
 *   • a remote typist expires TYPING_EXPIRY_MS after their last heartbeat
 *
 * Uses Cloudflare Realtime (chat room) instead of Supabase Broadcast.
 * Event: typing  Payload: { user_id, name, typing: boolean, ts }
 *
 * The sender's device timestamp is intentionally ignored — a skewed clock made
 * the indicator stick forever or never appear. Arrival time is the only clock
 * all parties agree on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { useAuth } from '@/context/AuthContext';

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

export interface TypingUser {
  id: string;
  name: string;
}

/** "Ada is typing…" / "Ada and Max are typing…" / "Ada and 3 others are typing…" */
export function typingLabelFor(users: TypingUser[]): string | null {
  if (users.length === 0) return null;
  if (users.length === 1) return `${users[0].name} is typing…`;
  if (users.length === 2) return `${users[0].name} and ${users[1].name} are typing…`;
  return `${users[0].name} and ${users.length - 1} others are typing…`;
}

export function useTypingPresence(communityId: string) {
  const { user } = useAuth();
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  const typingMapRef = useRef<Map<string, { name: string; lastSeen: number }>>(new Map());
  /** Last value handed to setTypingUsers, so unchanged flushes skip the setState. */
  const lastFlushedRef = useRef<TypingUser[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentAtRef = useRef(0);
  const isTypingRef = useRef(false);
  const identityRef = useRef({ user_id: user?.id ?? '', name: user?.name ?? 'Someone' });
  identityRef.current = { user_id: user?.id ?? '', name: user?.name ?? 'Someone' };

  const flushTypingUsers = useCallback(() => {
    const now = Date.now();
    for (const [id, entry] of typingMapRef.current.entries()) {
      if (now - entry.lastSeen > TYPING_EXPIRY_MS) typingMapRef.current.delete(id);
    }
    const users = [...typingMapRef.current.entries()]
      .map(([id, { name }]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const prev = lastFlushedRef.current;
    const unchanged =
      users.length === prev.length &&
      users.every((u, i) => prev[i] && prev[i].id === u.id && prev[i].name === u.name);
    if (unchanged) return;

    lastFlushedRef.current = users;
    setTypingUsers(users);
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const room = realtimeRooms.chat(communityId);

    realtimeClient.init({ id: user.id, name: user.name ?? null, avatar: null });
    realtimeClient.connect(room);
    // Refcounted room subscription — see useChatMessages.
    const unsubRoom = realtimeClient.subscribe(room);
    lastSentAtRef.current = 0;

    const unsub = realtimeClient.on(room, 'typing', (data) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      const senderId = typeof payload?.user_id === 'string' ? payload.user_id : '';
      const name = typeof payload?.name === 'string' ? payload.name : 'Someone';
      const isTyping = payload?.typing === true;

      if (!senderId || senderId === user.id) return;

      if (isTyping) {
        typingMapRef.current.set(senderId, { name, lastSeen: Date.now() });
      } else {
        typingMapRef.current.delete(senderId);
      }
      flushTypingUsers();
    });

    const expiryTimer = setInterval(flushTypingUsers, 1000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      isTypingRef.current = false;
      lastSentAtRef.current = 0;
      clearInterval(expiryTimer);
      typingMapRef.current.clear();
      lastFlushedRef.current = [];
      unsub();
      unsubRoom();
      setTypingUsers([]);
    };
  }, [communityId, user?.id, user?.name, flushTypingUsers]);

  const broadcast = useCallback(
    (typing: boolean) => {
      const room = realtimeRooms.chat(communityId);
      const now = Date.now();
      if (typing && now - lastSentAtRef.current < TYPING_THROTTLE_MS) return;
      lastSentAtRef.current = typing ? now : 0;
      realtimeClient.publish(room, 'typing', {
        ...identityRef.current,
        typing,
        ts: now,
      });
    },
    [communityId],
  );

  const setTyping = useCallback(
    (typing: boolean) => {
      isTypingRef.current = typing;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      broadcast(typing);
      if (typing) {
        idleTimerRef.current = setTimeout(() => {
          isTypingRef.current = false;
          broadcast(false);
        }, TYPING_IDLE_MS);
      }
    },
    [broadcast],
  );

  /** Call on every keystroke. Stops typing automatically when the box empties. */
  const onInputChange = useCallback(
    (text: string) => {
      setTyping(text.length > 0);
    },
    [setTyping],
  );

  const stopTyping = useCallback(() => {
    if (isTypingRef.current) setTyping(false);
  }, [setTyping]);

  return { typingUsers, typingLabel: typingLabelFor(typingUsers), onInputChange, stopTyping };
}
