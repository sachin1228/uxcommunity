"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

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
  identityRef.current = { user_id: currentUserId, name: currentUserName };

  const typingMapRef = useRef<Map<string, { name: string; lastSeen: number }>>(new Map());

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
    (typing: boolean) => {
      const chatRoom = realtimeRooms.chat(communityId);
      const now = Date.now();
      if (typing && now - lastSentAtRef.current < TYPING_THROTTLE_MS) return;
      lastSentAtRef.current = typing ? now : 0;
      realtimeClient.publish(chatRoom, "typing", {
        ...identityRef.current,
        typing,
        ts: now,
      });
    },
    [communityId],
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

    const chatRoom = realtimeRooms.chat(communityId);
    realtimeClient.init({ id: currentUserId, name: currentUserName, avatar: null });
    realtimeClient.subscribe(chatRoom);
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
      flushTypingUsers();
    });

    const expiryTimer = window.setInterval(flushTypingUsers, 1000);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      typingRef.current = false;
      lastSentAtRef.current = 0;
      window.clearInterval(expiryTimer);
      typingMapRef.current.clear();
      unsub();
      realtimeClient.unsubscribe(chatRoom);
      setTypingUsers([]);
    };
  }, [communityId, currentUserId, currentUserName, flushTypingUsers, isVisible]);

  return { typingUsers, setTyping };
}
