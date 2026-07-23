"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_HEARTBEAT_MS = 1000;

export interface TypingUser {
  id: string;
  name: string;
}

interface TypingPresence {
  user_id?: unknown;
  name?: unknown;
  typing?: unknown;
  last_seen?: unknown;
}

function readTypingUsers(
  channel: RealtimeChannel,
  currentUserId: string,
): TypingUser[] {
  const state = channel.presenceState() as Record<string, TypingPresence[]>;
  const users = new Map<string, TypingUser>();
  const now = Date.now();

  for (const presences of Object.values(state)) {
    for (const presence of presences) {
      const id = typeof presence.user_id === "string" ? presence.user_id : "";
      if (!id || id === currentUserId || presence.typing !== true) continue;

      const lastSeen =
        typeof presence.last_seen === "number" ? presence.last_seen : 0;
      if (now - lastSeen > TYPING_EXPIRY_MS) continue;

      const name = typeof presence.name === "string" ? presence.name : "Someone";
      if (!users.has(id)) users.set(id, { id, name });
    }
  }

  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Publishes ephemeral typing state over Supabase Presence.
 *
 * Typing is deliberately not persisted or sent through the messages API:
 * it is a short-lived UI signal and expires locally if a client disappears.
 */
export function useTypingPresence({
  communityId,
  currentUserId,
  currentUserName,
}: {
  communityId: string;
  currentUserId: string;
  currentUserName: string;
}) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPublishedTypingRef = useRef<boolean | null>(null);
  const lastPublishedAtRef = useRef(0);
  const identityRef = useRef({ user_id: currentUserId, name: currentUserName });
  identityRef.current = { user_id: currentUserId, name: currentUserName };

  const refreshTypingUsers = useCallback(
    (channel: RealtimeChannel) => {
      setTypingUsers(readTypingUsers(channel, currentUserId));
    },
    [currentUserId],
  );

  const publishTyping = useCallback((typing: boolean) => {
    const channel = channelRef.current;
    if (!channel) return;

    const now = Date.now();
    const shouldThrottle =
      typing &&
      lastPublishedTypingRef.current === true &&
      now - lastPublishedAtRef.current < TYPING_HEARTBEAT_MS;
    if (!shouldThrottle && lastPublishedTypingRef.current !== typing) {
      lastPublishedTypingRef.current = typing;
      lastPublishedAtRef.current = now;
      void channel.track({
        ...identityRef.current,
        typing,
        last_seen: now,
      });
    } else if (typing && !shouldThrottle) {
      lastPublishedAtRef.current = now;
      void channel.track({
        ...identityRef.current,
        typing: true,
        last_seen: now,
      });
    }
  }, []);

  const setTyping = useCallback(
    (typing: boolean) => {
      typingRef.current = typing;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      publishTyping(typing);

      if (typing) {
        idleTimerRef.current = setTimeout(() => {
          typingRef.current = false;
          publishTyping(false);
        }, TYPING_IDLE_MS);
      }
    },
    [publishTyping],
  );

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channel = supabase.channel(`community-typing:${communityId}`);
    channelRef.current = channel;
    lastPublishedTypingRef.current = null;
    lastPublishedAtRef.current = 0;

    const refresh = () => refreshTypingUsers(channel);
    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        // Force the first publish for this channel even when the user was
        // already typing before the subscription finished.
        lastPublishedTypingRef.current = null;
        lastPublishedAtRef.current = 0;
        publishTyping(typingRef.current);
        refresh();
      });

    const expiryTimer = window.setInterval(refresh, 1000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      typingRef.current = false;
      channelRef.current = null;
      lastPublishedTypingRef.current = null;
      lastPublishedAtRef.current = 0;
      window.clearInterval(expiryTimer);
      void channel.untrack();
      supabase.removeChannel(channel);
      setTypingUsers([]);
    };
  }, [communityId, publishTyping, refreshTypingUsers]);

  return { typingUsers, setTyping };
}