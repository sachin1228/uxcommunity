"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/publish";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

export interface TypingUser {
  id: string;
  name: string;
}

/**
 * Broadcasts ephemeral typing state over the Cloudflare realtime service.
 *
 * Typing is a fire-and-forget event bus with no persistent state: the DO
 * rebroadcasts each publish to the room's other members (the sender is
 * excluded automatically, mirroring Supabase's `self: false`).
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
  const clientRef = useRef<RealtimeClient | null>(null);
  const isVisible = useDocumentVisible();
  const typingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks when we last broadcast a "typing: true" so we can throttle heartbeats
  const lastSentAtRef = useRef(0);
  const identityRef = useRef({ user_id: currentUserId, name: currentUserName });
  identityRef.current = { user_id: currentUserId, name: currentUserName };

  // Local map: user_id → { name, lastSeen }
  // Managed entirely on the client — no dependency on server presence state.
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
   * Send a typing event.
   *
   * - State transitions (false→true, true→false) are always sent immediately.
   * - Repeated "still typing" heartbeats are throttled to once per TYPING_THROTTLE_MS.
   * - Resetting lastSentAtRef to 0 on "stopped typing" ensures the very next
   *   "started typing" event is never accidentally throttled.
   */
  const broadcast = useCallback(
    (typing: boolean) => {
      const client = clientRef.current;
      if (!client) return;

      const now = Date.now();

      // Only throttle repeated heartbeats while still typing
      if (typing && now - lastSentAtRef.current < TYPING_THROTTLE_MS) return;

      // Reset to 0 when stopped so the next "typing: true" is never throttled
      lastSentAtRef.current = typing ? now : 0;

      client.publish("typing", {
        ...identityRef.current,
        typing,
        ts: now,
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
    if (!isVisible) return;
    const client = new RealtimeClient({
      room: realtimeRooms.typing(communityId),
      user: { id: currentUserId, name: currentUserName, avatar: null },
    });
    clientRef.current = client;
    lastSentAtRef.current = 0;

    const unsub = client.on(
      "typing",
      (data) => {
        const payload = (data ?? {}) as Record<string, unknown>;
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
    );

    client.connect();

    // Sweep the local map every second to expire anyone who went silent
    // without sending an explicit "typing: false" (e.g. closed the tab).
    const expiryTimer = window.setInterval(flushTypingUsers, 1000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      typingRef.current = false;
      clientRef.current = null;
      lastSentAtRef.current = 0;
      window.clearInterval(expiryTimer);
      typingMapRef.current.clear();
      unsub();
      client.close();
      setTypingUsers([]);
    };
  }, [communityId, currentUserId, flushTypingUsers, isVisible]);

  return { typingUsers, setTyping };
}