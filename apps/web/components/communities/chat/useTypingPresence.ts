"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

/** Monotonic counter for typing event IDs (returned by the server on broadcast). */
let _typingSeq = 0;

export interface TypingUser {
  id: string;
  name: string;
}

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
  const isVisible = useDocumentVisible();
  const typingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentAtRef = useRef(0);
  const identityRef = useRef({ user_id: currentUserId, name: currentUserName });
  const activeTimerSessionRef = useRef(0);

  const typingMapRef = useRef<Map<string, { name: string; lastSeen: number }>>(new Map());

  // Keep identityRef in sync without writing during render (react-hooks/refs).
  useEffect(() => {
    identityRef.current = { user_id: currentUserId, name: currentUserName };
  });

  const flushTypingUsers = useCallback(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of typingMapRef.current.entries()) {
      if (now - entry.lastSeen > TYPING_EXPIRY_MS) {
        typingMapRef.current.delete(id);
        changed = true;
      }
    }
    if (changed || true) {
      const users = [...typingMapRef.current.entries()]
        .map(([id, { name }]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTypingUsers(users);
    }
  }, []);

  const broadcast = useCallback(
    (typing: boolean, source: string) => {
      const chatRoom = realtimeRooms.chat(communityId);
      const now = Date.now();
      const elapsed = now - lastSentAtRef.current;
      const throttled = typing && elapsed < TYPING_THROTTLE_MS;
      const eventId = typing ? `e${++_typingSeq}` : undefined;

      if (throttled) {
        return;
      }

      lastSentAtRef.current = typing ? now : 0;
      realtimeClient.publish(chatRoom, "typing", {
        ...identityRef.current,
        typing,
        ts: now,
        eid: eventId,
      });
    },
    [communityId],
  );

  const broadcastRef = useRef(broadcast);

  // Keep broadcastRef in sync without writing during render (react-hooks/refs).
  useEffect(() => {
    broadcastRef.current = broadcast;
  });

  const setTyping = useCallback(
    (typing: boolean, source: string) => {
      typingRef.current = typing;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      broadcast(typing, source);
      if (typing) {
        activeTimerSessionRef.current += 1;
        const timerSession = activeTimerSessionRef.current;
        idleTimerRef.current = setTimeout(() => {
          if (timerSession !== activeTimerSessionRef.current) {
            return;
          }
          typingRef.current = false;
          broadcast(false, "idle-timer");
        }, TYPING_IDLE_MS);
      }
    },
    [broadcast],
  );

  // ── Typing subscription — lives for the lifetime of the community/user ──
  // Visibility does NOT tear this down. Only communityId or user change does.
  useEffect(() => {
    const chatRoom = realtimeRooms.chat(communityId);
    realtimeClient.init({ id: currentUserId, name: currentUserName, avatar: null });
    const unsubRoom = realtimeClient.subscribe(chatRoom);
    realtimeClient.connect();
    lastSentAtRef.current = 0;

    const unsub = realtimeClient.on(chatRoom, "typing", (data) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      const userId = typeof payload?.user_id === "string" ? payload.user_id : "";
      const name = typeof payload?.name === "string" ? payload.name : "Someone";
      const typing = payload?.typing === true;
      const ts = typeof payload?.ts === "number" ? payload.ts : Date.now();
      if (!userId || userId === currentUserId) return;
      if (typing) {
        typingMapRef.current.set(userId, { name, lastSeen: ts });
      } else {
        typingMapRef.current.delete(userId);
      }
      const users = [...typingMapRef.current.entries()]
        .map(([id, { name: n }]) => ({ id, name: n }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTypingUsers(users);
    });

    const expiryTimer = window.setInterval(flushTypingUsers, 1000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      typingRef.current = false;
      lastSentAtRef.current = 0;
      window.clearInterval(expiryTimer);
      typingMapRef.current.clear();
      unsub();
      unsubRoom();
      setTypingUsers([]);
    };
  }, [communityId, currentUserId, currentUserName, flushTypingUsers]);

  // ── Visibility transition: send typing:false when becoming hidden ──────
  // Separated from the subscription lifecycle so the subscription stays
  // alive across visibility changes. This only controls outgoing events.
  useEffect(() => {
    if (!isVisible && typingRef.current) {
      typingRef.current = false;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      broadcastRef.current(false, "visibility");
    }
  }, [isVisible]);

  return { typingUsers, setTyping };
}
