"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sendDmTypingPulse } from "@/lib/direct-messages/client";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

export interface DmTypingUser {
  id: string;
  name: string;
}

/**
 * Typing presence for DM threads.
 *
 * Sending: a throttled POST pulse (the peer's Durable Object is only reachable
 * through the server publish path — see the typing route), auto-stopped after
 * 1.6 s of silence, roomed to the ACTIVE conversation.
 *
 * Receiving: the view's realtime hook funnels `dm-typing` events into
 * `applyEvent`; a 1 s sweep expires stale entries. `typingUsers` is derived
 * for the active conversation only.
 */
export function useDmTyping({
  activeConversationId,
  currentUserId,
}: {
  activeConversationId: string | null;
  currentUserId: string;
}) {
  const activeIdRef = useRef(activeConversationId);
  activeIdRef.current = activeConversationId;

  // conversationId → userId → { name, lastSeen }
  const typingMapRef = useRef(new Map<string, Map<string, { name: string; lastSeen: number }>>());
  const [typingUsers, setTypingUsers] = useState<DmTypingUser[]>([]);

  const lastSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSentRef = useRef(false);

  const refreshTypingUsers = useCallback(() => {
    const activeId = activeIdRef.current;
    const perUser = activeId ? typingMapRef.current.get(activeId) : undefined;
    const now = Date.now();
    const users: DmTypingUser[] = [];
    if (perUser) {
      for (const [id, entry] of perUser) {
        if (now - entry.lastSeen > TYPING_EXPIRY_MS) perUser.delete(id);
        else users.push({ id, name: entry.name });
      }
    }
    setTypingUsers(users.sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  // Expiry sweep + re-derive when the thread switches.
  useEffect(() => {
    refreshTypingUsers();
    const timer = window.setInterval(refreshTypingUsers, 1000);
    return () => window.clearInterval(timer);
  }, [refreshTypingUsers, activeConversationId]);

  const applyEvent = useCallback(
    (event: { conversation_id: string; user_id: string; name?: string; typing: boolean }) => {
      if (event.user_id === currentUserId) return;
      let perUser = typingMapRef.current.get(event.conversation_id);
      if (!perUser) {
        perUser = new Map();
        typingMapRef.current.set(event.conversation_id, perUser);
      }
      if (event.typing) {
        // Arrival time is the only clock all parties agree on — the sender's
        // device timestamp caused stuck or never-showing indicators in the
        // community chat.
        perUser.set(event.user_id, { name: event.name ?? "Someone", lastSeen: Date.now() });
      } else {
        perUser.delete(event.user_id);
      }
      refreshTypingUsers();
    },
    [currentUserId, refreshTypingUsers],
  );

  const clearUser = useCallback(
    (conversationId: string, userId: string) => {
      typingMapRef.current.get(conversationId)?.delete(userId);
      refreshTypingUsers();
    },
    [refreshTypingUsers],
  );

  const clearConversation = useCallback(
    (conversationId: string) => {
      typingMapRef.current.delete(conversationId);
      refreshTypingUsers();
    },
    [refreshTypingUsers],
  );

  /** Composer activity → throttled pulses for the active conversation. */
  const setTyping = useCallback((typing: boolean) => {
    const target = activeIdRef.current;
    if (!target) return;

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const now = Date.now();

    if (typing) {
      if (now - lastSentAtRef.current >= TYPING_THROTTLE_MS) {
        lastSentAtRef.current = now;
        stopSentRef.current = false;
        sendDmTypingPulse(target, true);
      }
      idleTimerRef.current = setTimeout(() => {
        lastSentAtRef.current = 0;
        stopSentRef.current = true;
        sendDmTypingPulse(target, false);
      }, TYPING_IDLE_MS);
    } else if (!stopSentRef.current && lastSentAtRef.current > 0) {
      lastSentAtRef.current = 0;
      stopSentRef.current = true;
      sendDmTypingPulse(target, false);
    }
  }, []);

  // Switching threads ends the previous thread's typing pulse immediately.
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    lastSentAtRef.current = 0;
    stopSentRef.current = false;
    setTypingUsers([]);
  }, [activeConversationId]);

  return { typingUsers, setTyping, applyEvent, clearUser, clearConversation };
}
