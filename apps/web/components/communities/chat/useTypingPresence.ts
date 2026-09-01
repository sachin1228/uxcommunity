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
let _instanceCounter = 0;
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
  const instanceIdRef = useRef(++_instanceCounter);
  const activeTimerSessionRef = useRef(0);

  const typingMapRef = useRef<Map<string, { name: string; lastSeen: number }>>(new Map());

  // ── DIAGNOSTIC: mount/unmount ──────────────────────────────────────────
  useEffect(() => {
    console.log(`[RT-DIAG] MOUNT useTypingPresence instance=${instanceIdRef.current} community=${communityId} user=${currentUserId}`);
    return () => {
      console.log(`[RT-DIAG] UNMOUNT useTypingPresence instance=${instanceIdRef.current} community=${communityId}`);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ────────────────────────────────────────────────────────────────────────

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
        console.log(`[RT-DIAG] SEND_THROTTLED source=${source} elapsed=${elapsed}ms throttle=${TYPING_THROTTLE_MS}ms`);
        return;
      }

      lastSentAtRef.current = typing ? now : 0;
      console.log(`[RT-DIAG] SEND typing=${typing} source=${source} eventId=${eventId ?? "none"} instance=${instanceIdRef.current} session=${sessionRef.current}`);
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
      console.log(`[RT-DIAG] SET_TYPING typing=${typing} source=${source} instance=${instanceIdRef.current} prev=${typingRef.current}`);
      typingRef.current = typing;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      broadcast(typing, source);
      if (typing) {
        activeTimerSessionRef.current += 1;
        const timerSession = activeTimerSessionRef.current;
        console.log(`[RT-DIAG] IDLE_TIMER_CREATE session=${timerSession} delay=${TYPING_IDLE_MS}ms`);
        idleTimerRef.current = setTimeout(() => {
          console.log(`[RT-DIAG] IDLE_TIMER_FIRE session=${timerSession} currentSession=${activeTimerSessionRef.current} match=${timerSession === activeTimerSessionRef.current}`);
          if (timerSession !== activeTimerSessionRef.current) {
            console.log(`[RT-DIAG] IDLE_TIMER_STALE ignored`);
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

    // ── DIAGNOSTIC: log refCount after subscription ────────────────────
    const roomState = (realtimeClient as unknown as { rooms: Map<string, { topicRefs: Map<string, number> }> }).rooms.get(chatRoom);
    const typingRefCt = roomState?.topicRefs.get("typing") ?? 0;
    console.log(`[RT-DIAG] SUBSCRIBE room=${chatRoom} topic=typing refCount=${typingRefCt} instance=${instanceIdRef.current}`);
    // ────────────────────────────────────────────────────────────────────

    const unsub = realtimeClient.on(chatRoom, "typing", (data) => {
      const payload = (data ?? {}) as Record<string, unknown>;
      const userId = typeof payload?.user_id === "string" ? payload.user_id : "";
      const name = typeof payload?.name === "string" ? payload.name : "Someone";
      const typing = payload?.typing === true;
      const ts = typeof payload?.ts === "number" ? payload.ts : Date.now();
      const eid = typeof payload?.eid === "string" ? payload.eid : "?";
      if (!userId || userId === currentUserId) return;
      console.log(`[RT-DIAG] RECV typing=${typing} eid=${eid} from=${userId}(${name}) instance=${instanceIdRef.current}`);
      if (typing) {
        typingMapRef.current.set(userId, { name, lastSeen: ts });
      } else {
        typingMapRef.current.delete(userId);
      }
      const users = [...typingMapRef.current.entries()]
        .map(([id, { name: n }]) => ({ id, name: n }))
        .sort((a, b) => a.name.localeCompare(b.name));
      console.log(`[RT-DIAG] STATE mapSize=${typingMapRef.current.size} users=[${users.map((u) => u.name).join(",")}] instance=${instanceIdRef.current}`);
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
      console.log(`[RT-DIAG] VISIBILITY_HIDE sending typing=false instance=${instanceIdRef.current}`);
      typingRef.current = false;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      broadcastRef.current(false, "visibility");
    }
  }, [isVisible]);

  // ── DIAGNOSTIC: log full state on visibility return ────────────────────
  useEffect(() => {
    if (isVisible) {
      sessionRef.current += 1;
      const chatRoom = realtimeRooms.chat(communityId);
      const conn = (realtimeClient as unknown as { connections: Map<string, { ws: WebSocket | null; connected: boolean; pending: string[] }> }).connections.get(chatRoom);
      console.log(`[RT-DIAG] VISIBILITY_RETURN session=${sessionRef.current} instance=${instanceIdRef.current} room=${chatRoom} readyState=${conn?.ws?.readyState} connected=${conn?.connected} pending=${conn?.pending?.length} typingRef=${typingRef.current} lastSentAt=${lastSentAtRef.current}`);
    }
  }, [isVisible, communityId]);

  return { typingUsers, setTyping };
}
