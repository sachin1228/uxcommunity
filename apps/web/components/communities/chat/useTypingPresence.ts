"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

const TYPING_IDLE_MS = 1600;
const TYPING_EXPIRY_MS = 3500;
const TYPING_THROTTLE_MS = 1000;

// ── DIAGNOSTIC: typing event ID counter ─────────────────────────────────
let _typingSeq = 0;
// ────────────────────────────────────────────────────────────────────────

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
  const sessionRef = useRef(0);

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
    (typing: boolean) => {
      const chatRoom = realtimeRooms.chat(communityId);
      const now = Date.now();
      const elapsed = now - lastSentAtRef.current;
      const throttled = typing && elapsed < TYPING_THROTTLE_MS;
      const eventId = typing ? `e${++_typingSeq}` : undefined;

      if (throttled) {
        console.log(`[RT-DIAG] SEND_THROTTLED elapsed=${elapsed}ms throttle=${TYPING_THROTTLE_MS}ms`);
        return;
      }

      lastSentAtRef.current = typing ? now : 0;
      console.log(`[RT-DIAG] SEND typing=${typing} eventId=${eventId ?? "none"} session=${sessionRef.current} lastSent=${lastSentAtRef.current === 0 ? "0" : "set"}`);
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
      const eid = typeof payload?.eid === "string" ? payload.eid : "?";
      if (!userId || userId === currentUserId) return;
      console.log(`[RT-DIAG] RECV typing=${typing} eid=${eid} from=${userId}(${name})`);
      if (typing) {
        typingMapRef.current.set(userId, { name, lastSeen: ts });
      } else {
        typingMapRef.current.delete(userId);
      }
      const users = [...typingMapRef.current.entries()]
        .map(([id, { name: n }]) => ({ id, name: n }))
        .sort((a, b) => a.name.localeCompare(b.name));
      console.log(`[RT-DIAG] STATE mapSize=${typingMapRef.current.size} users=[${users.map((u) => u.name).join(",")}]`);
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
      broadcastRef.current(false);
    }
  }, [isVisible]);

  // ── DIAGNOSTIC: log full state on visibility return ────────────────────
  useEffect(() => {
    if (isVisible) {
      sessionRef.current += 1;
      const chatRoom = realtimeRooms.chat(communityId);
      const conn = (realtimeClient as unknown as { connections: Map<string, { ws: WebSocket | null; connected: boolean; pending: string[] }> }).connections.get(chatRoom);
      console.log(`[RT-DIAG] VISIBILITY_RETURN session=${sessionRef.current} room=${chatRoom} readyState=${conn?.ws?.readyState} connected=${conn?.connected} pending=${conn?.pending?.length} typingRef=${typingRef.current} lastSentAt=${lastSentAtRef.current}`);
    }
  }, [isVisible, communityId]);

  return { typingUsers, setTyping };
}
