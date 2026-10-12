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
 * The one-line label a conversation row shows in place of its preview while
 * the peer types. The peer's name is already the row's title, so the label
 * stays as terse as the messenger this list imitates.
 */
const DM_TYPING_LABEL = "typing…";

/** Value-equality guards: the 1 s sweep runs continuously, and a fresh array
 *  or Map every tick would re-render the whole view for nothing. */
function sameTypingUsers(a: DmTypingUser[], b: DmTypingUser[]): boolean {
  return a.length === b.length && a.every((u, i) => u.id === b[i].id && u.name === b[i].name);
}

function sameTypingMap(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a.entries()].every(([key, value]) => b.get(key) === value);
}

/**
 * Typing presence for DM threads.
 *
 * Sending: a throttled POST pulse (the peer's Durable Object is only reachable
 * through the server publish path — see the typing route), auto-stopped after
 * 1.6 s of silence, roomed to the ACTIVE conversation.
 *
 * Receiving: the view's realtime hook funnels `dm-typing` events into
 * `applyEvent`; a 1 s sweep expires stale entries. `typingUsers` is derived for
 * the active conversation (the indicator above the composer) and
 * `typingByConversation` for EVERY conversation (the list rows), mirroring the
 * community sidebar's per-row typing text.
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
  // conversationId → row label, for the conversation list (every conversation,
  // not just the open one).
  const [typingByConversation, setTypingByConversation] = useState<Map<string, string>>(new Map());

  const lastSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSentRef = useRef(false);
  /** Last values handed to setState, so unchanged sweeps skip the render. */
  const lastTypingUsersRef = useRef<DmTypingUser[]>([]);
  const lastTypingByConversationRef = useRef<Map<string, string>>(new Map());

  const refreshTypingUsers = useCallback(() => {
    const now = Date.now();
    const byConversation = new Map<string, string>();
    // Sweep EVERY conversation, not just the open one: an entry left behind in
    // a background conversation would otherwise keep its row's "typing…"
    // pinned until it was opened.
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
    const users: DmTypingUser[] = perActive
      ? [...perActive.entries()]
          .map(([id, entry]) => ({ id, name: entry.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    if (!sameTypingUsers(lastTypingUsersRef.current, users)) {
      lastTypingUsersRef.current = users;
      setTypingUsers(users);
    }
    if (!sameTypingMap(lastTypingByConversationRef.current, byConversation)) {
      lastTypingByConversationRef.current = byConversation;
      setTypingByConversation(byConversation);
    }
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
  // The list's per-conversation map is deliberately left alone — a peer still
  // typing in another conversation keeps its row lit.
  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    lastSentAtRef.current = 0;
    stopSentRef.current = false;
    lastTypingUsersRef.current = [];
    setTypingUsers([]);
  }, [activeConversationId]);

  return {
    typingUsers,
    typingByConversation,
    setTyping,
    applyEvent,
    clearUser,
    clearConversation,
  };
}
