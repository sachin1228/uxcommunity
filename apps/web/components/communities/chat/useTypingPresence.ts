"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

export interface TypingUser {
  id: string;
  name: string;
}

/**
 * Broadcasts ephemeral typing state over Supabase Broadcast.
 *
 * Broadcast is used instead of Presence because Presence relies on a stateful
 * channel state machine that silently stops accepting `track()` calls after the
 * channel has been idle for a while (requires a full page refresh to recover).
 * Broadcast is a simple fire-and-forget event bus with no persistent state,
 * making it immune to that class of drift/reconnect bugs.
 *
 * Each typing user is tracked locally with a `lastSeen` timestamp; the expiry
 * timer removes anyone who hasn't sent a heartbeat in TYPING_EXPIRY_MS ms.
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
  // Tracks when we last broadcast a "typing: true" so we can throttle heartbeats
  const lastSentAtRef = useRef(0);
  const identityRef = useRef({ user_id: currentUserId, name: currentUserName });
  identityRef.current = { user_id: currentUserId, name: currentUserName };

  // Local map: user_id → { name, lastSeen }
  // Managed entirely on the client — no dependency on Supabase's presence state.
  const typingMapRef = useRef<Map<string, { name: string; lastSeen: number }>>(
    new Map(),
  );

  /** Expire stale entries and push the updated list into React state. */
  const flushTypingUsers = useCallback(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of typingMapRef.current.entries()) {
      if (now - entry.lastSeen > TYPING_EXPIRY_MS) {
        typingMapRef.current.delete(id);
        changed = true;
      }
    }
    // Always call setTypingUsers on expiry runs so the UI stays correct even
    // if a broadcast "stop typing" message was missed (e.g. the sender closed
    // their tab mid-session).
    if (changed || true) {
      const users = [...typingMapRef.current.entries()]
        .map(([id, { name }]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTypingUsers(users);
    }
  }, []);

  /**
   * Send a broadcast typing event.
   *
   * - State transitions (false→true, true→false) are always sent immediately.
   * - Repeated "still typing" heartbeats are throttled to once per TYPING_THROTTLE_MS.
   * - Resetting lastSentAtRef to 0 on "stopped typing" ensures the very next
   *   "started typing" event is never accidentally throttled.
   */
  const broadcast = useCallback(
    (typing: boolean) => {
      const channel = channelRef.current;
      if (!channel) return;

      const now = Date.now();

      // Only throttle repeated heartbeats while still typing
      if (typing && now - lastSentAtRef.current < TYPING_THROTTLE_MS) return;

      // Reset to 0 when stopped so the next "typing: true" is never throttled
      lastSentAtRef.current = typing ? now : 0;

      void channel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          ...identityRef.current,
          typing,
          ts: now,
        },
      });
    },
    [],
  );

  const setTyping = useCallback(
    (typing: boolean) => {
      typingRef.current = typing;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      broadcast(typing);

      if (typing) {
        idleTimerRef.current = setTimeout(() => {
          typingRef.current = false;
          broadcast(false);
        }, TYPING_IDLE_MS);
      }
    },
    [broadcast],
  );

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    typingMapRef.current.clear();
    setTypingUsers([]);

    const channel = supabase.channel(`community-typing:${communityId}`, {
      config: {
        broadcast: { ack: false, self: false },
      },
    });
    channelRef.current = channel;
    lastSentAtRef.current = 0;

    channel
      .on(
        "broadcast",
        { event: "typing" },
        ({ payload }: { payload: Record<string, unknown> }) => {
          const userId =
            typeof payload?.user_id === "string" ? payload.user_id : "";
          const name =
            typeof payload?.name === "string" ? payload.name : "Someone";
          const typing = payload?.typing === true;
          const ts =
            typeof payload?.ts === "number" ? payload.ts : Date.now();

          if (!userId || userId === currentUserId) return;

          if (typing) {
            typingMapRef.current.set(userId, { name, lastSeen: ts });
          } else {
            typingMapRef.current.delete(userId);
          }
          flushTypingUsers();
        },
      )
      .subscribe();

    // Sweep the local map every second to expire anyone who went silent
    // without sending an explicit "typing: false" (e.g. closed the tab).
    const expiryTimer = window.setInterval(flushTypingUsers, 1000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      typingRef.current = false;
      channelRef.current = null;
      lastSentAtRef.current = 0;
      window.clearInterval(expiryTimer);
      typingMapRef.current.clear();
      supabase.removeChannel(channel);
      setTypingUsers([]);
    };
  }, [communityId, currentUserId, flushTypingUsers]);

  return { typingUsers, setTyping };
}
