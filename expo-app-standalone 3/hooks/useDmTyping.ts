/**
 * Typing presence for DM threads — the mobile counterpart of the web
 * useDmTyping. A typing pulse must cross to the peer's Durable Object through
 * the server, so it is a throttled POST (unlike community chat's socket
 * broadcast); incoming pulses arrive on the `dm:${userId}` room.
 *
 * The same hook serves the conversation list (`activeConversationId = null`),
 * where it exposes `typingByConversation` for the row previews, and the open
 * thread, where it also sends the composer's pulses and exposes `typingUsers`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { sendDmTyping } from '@/lib/dmApi';
import { useAuth } from '@/context/AuthContext';
import type { TypingUser } from '@/hooks/useTypingPresence';

const TYPING_IDLE_MS = 1_600;
const TYPING_EXPIRY_MS = 3_500;
const TYPING_THROTTLE_MS = 1_000;

export const DM_TYPING_LABEL = 'typing…';

interface TypingEntry {
  name: string;
  lastSeen: number;
}

function sameUsers(a: TypingUser[], b: TypingUser[]): boolean {
  return a.length === b.length && a.every((user, i) => user.id === b[i].id && user.name === b[i].name);
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a.entries()].every(([key, value]) => b.get(key) === value);
}

export function useDmTyping(activeConversationId: string | null) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const activeIdRef = useRef(activeConversationId);
  activeIdRef.current = activeConversationId;

  /** conversationId → userId → { name, lastSeen } */
  const typingMapRef = useRef(new Map<string, Map<string, TypingEntry>>());
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [typingByConversation, setTypingByConversation] = useState<Map<string, string>>(
    new Map(),
  );
  const lastUsersRef = useRef<TypingUser[]>([]);
  const lastMapRef = useRef<Map<string, string>>(new Map());

  const derive = useCallback(() => {
    const now = Date.now();
    const byConversation = new Map<string, string>();

    for (const [conversationId, perUser] of typingMapRef.current) {
      for (const [id, entry] of perUser) {
        if (now - entry.lastSeen > TYPING_EXPIRY_MS) perUser.delete(id);
      }
      if (perUser.size === 0) {
        typingMapRef.current.delete(conversationId);
        continue;
      }
      byConversation.set(conversationId, DM_TYPING_LABEL);
    }

    const activeId = activeIdRef.current;
    const perActive = activeId ? typingMapRef.current.get(activeId) : undefined;
    const users: TypingUser[] = perActive
      ? [...perActive.entries()]
          .map(([id, entry]) => ({ id, name: entry.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    if (!sameUsers(lastUsersRef.current, users)) {
      lastUsersRef.current = users;
      setTypingUsers(users);
    }
    if (!sameMap(lastMapRef.current, byConversation)) {
      lastMapRef.current = byConversation;
      setTypingByConversation(byConversation);
    }
  }, []);

  // The sweep runs only while the room is subscribed; it also expires users
  // when the member sits on the screen without new events.
  useEffect(() => {
    derive();
    const timer = setInterval(derive, 1_000);
    return () => clearInterval(timer);
  }, [derive, activeConversationId]);

  useEffect(() => {
    if (!userId) return;
    realtimeClient.init({ id: userId, name: user?.name ?? null, avatar: null });
    const room = realtimeRooms.dm(userId);
    realtimeClient.connect(room);

    const unsubscribe = realtimeClient.on(room, 'dm-typing', (data) => {
      const payload = data as {
        conversation_id?: string;
        user_id?: string;
        name?: string;
        typing?: boolean;
      } | null;
      if (!payload?.conversation_id || !payload.user_id) return;
      if (payload.user_id === userId) return;

      let perUser = typingMapRef.current.get(payload.conversation_id);
      if (!perUser) {
        perUser = new Map();
        typingMapRef.current.set(payload.conversation_id, perUser);
      }
      if (payload.typing) {
        // Arrival time — the sender's clock is not trusted (community parity).
        perUser.set(payload.user_id, {
          name: payload.name ?? 'Someone',
          lastSeen: Date.now(),
        });
      } else {
        perUser.delete(payload.user_id);
      }
      derive();
    });

    return unsubscribe;
  }, [derive, user?.name, userId]);

  // ── Sending pulses (the open thread only) ─────────────────────────────────
  const lastSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSentRef = useRef(true);
  const previousActiveRef = useRef<string | null>(activeConversationId);

  const stopPulse = useCallback((conversationId: string) => {
    stopSentRef.current = true;
    lastSentAtRef.current = 0;
    void sendDmTyping(conversationId, false).catch(() => {
      /* a lost stop pulse expires on the peer */
    });
  }, []);

  useEffect(() => {
    const previous = previousActiveRef.current;
    if (previous && previous !== activeConversationId) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
      if (!stopSentRef.current && lastSentAtRef.current > 0) stopPulse(previous);
    }
    previousActiveRef.current = activeConversationId;
    lastSentAtRef.current = 0;
    stopSentRef.current = true;
    lastUsersRef.current = [];
    setTypingUsers([]);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [activeConversationId, stopPulse]);

  const notifyTyping = useCallback(
    (typing: boolean) => {
      const target = activeIdRef.current;
      if (!target) return;

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      const now = Date.now();

      if (typing) {
        if (now - lastSentAtRef.current >= TYPING_THROTTLE_MS) {
          lastSentAtRef.current = now;
          stopSentRef.current = false;
          void sendDmTyping(target, true).catch(() => {
            /* the next keystroke sends another pulse */
          });
        }
        idleTimerRef.current = setTimeout(() => {
          idleTimerRef.current = null;
          if (!stopSentRef.current) stopPulse(target);
        }, TYPING_IDLE_MS);
      } else if (!stopSentRef.current && lastSentAtRef.current > 0) {
        stopPulse(target);
      }
    },
    [stopPulse],
  );

  return { typingUsers, typingByConversation, notifyTyping };
}
