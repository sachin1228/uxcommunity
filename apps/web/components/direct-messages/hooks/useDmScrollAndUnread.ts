"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
} from "react";
import type { DmMessage } from "@/lib/direct-messages/types";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Scroll positioning + the unread boundary for one DM conversation.
 *
 * Ported from the community chat's useScrollAndUnread with the community
 * coupling removed: the read marker arrives as a prop (the conversation
 * summary knew it when the thread opened, so there is no waiting game for a
 * SSR payload) and no sidebar is consulted.
 */
export function useDmScrollAndUnread({
  conversationId,
  currentUserId,
  messages,
  loading,
  initialMessagesReady,
  /** The conversation's my_last_read_at as it was when the thread opened. */
  myLastReadAtAtOpen,
}: {
  conversationId: string | null;
  currentUserId: string;
  messages: DmMessage[];
  loading: boolean;
  initialMessagesReady: boolean;
  myLastReadAtAtOpen: string | null | undefined;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const unreadDividerRef = useRef<HTMLDivElement>(null);

  const initialScrollDoneRef = useRef(false);
  const realtimeInsertPendingRef = useRef(false);
  const realtimeWasNearBottomRef = useRef(false);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [initialPositionResolved, setInitialPositionResolved] = useState(false);
  const [hideUnreadDivider, setHideUnreadDivider] = useState(false);

  const unreadAtOpenRef = useRef<{ firstMsgId: string | null; count: number } | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);

  // ── Reset on conversation switch ────────────────────────────────────────
  useIsomorphicLayoutEffect(() => {
    initialScrollDoneRef.current = false;
    realtimeInsertPendingRef.current = false;
    realtimeWasNearBottomRef.current = false;
    unreadAtOpenRef.current = null;
    setHideUnreadDivider(false);
    setSnapshotReady(false);
    setInitialPositionResolved(false);
    setShowScrollToBottom(false);
  }, [conversationId]);

  // ── Unread boundary snapshot (once the first page is in) ────────────────
  useEffect(() => {
    if (!conversationId || !initialMessagesReady || snapshotReady) return;
    const lastReadAt = myLastReadAtAtOpen ?? null;
    const lastReadTime = lastReadAt === null ? -Infinity : new Date(lastReadAt).getTime();
    const unreadMsgs = messages.filter(
      (m) =>
        !m.id.startsWith("temp-") &&
        m.user_id !== currentUserId &&
        new Date(m.created_at).getTime() > lastReadTime,
    );
    unreadAtOpenRef.current = {
      firstMsgId: unreadMsgs[0]?.id ?? null,
      count: unreadMsgs.length,
    };
    setSnapshotReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialMessagesReady, snapshotReady]);

  // ── Initial position: first unread (~80 px above) or the bottom ─────────
  useIsomorphicLayoutEffect(() => {
    if (!snapshotReady || loading || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;

    const container = scrollContainerRef.current;
    if (!container) {
      setInitialPositionResolved(true);
      return;
    }
    if (container.scrollHeight <= container.clientHeight) {
      setInitialPositionResolved(true);
      return;
    }
    const divider = unreadDividerRef.current;
    if (divider && unreadAtOpenRef.current?.firstMsgId) {
      const dividerRect = divider.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const dividerTop = dividerRect.top - containerRect.top + container.scrollTop;
      container.scrollTop = Math.max(0, dividerTop - 80);
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
    setInitialPositionResolved(true);
  }, [snapshotReady, loading, conversationId]);

  // ── Realtime auto-scroll (near the bottom → follow; else show the pill) ─
  useEffect(() => {
    if (!initialScrollDoneRef.current || !realtimeInsertPendingRef.current) return;
    realtimeInsertPendingRef.current = false;
    if (realtimeWasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowScrollToBottom(true);
    }
  }, [messages]);

  // ── Pill visibility + divider dismissal on scroll ───────────────────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollToBottom(dist > 80);
      if (dist <= 80 && firstUnreadMsgIdRef.current) {
        setHideUnreadDivider(true);
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [conversationId]);

  const firstUnreadMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    firstUnreadMsgIdRef.current =
      snapshotReady ? (unreadAtOpenRef.current?.firstMsgId ?? null) : null;
  }, [snapshotReady]);

  const realMessages = useMemo(
    () => messages.filter((m) => !m.id.startsWith("temp-")),
    [messages],
  );

  const firstUnreadMsgId: string | null =
    snapshotReady && !hideUnreadDivider
      ? (unreadAtOpenRef.current?.firstMsgId ?? null)
      : null;

  const unreadDisplayCount = useMemo(() => {
    if (!snapshotReady) return 0;
    const lastReadAt = myLastReadAtAtOpen ?? null;
    return realMessages.filter(
      (m) =>
        m.user_id !== currentUserId &&
        (lastReadAt === null ||
          new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()),
    ).length;
  }, [snapshotReady, realMessages, currentUserId, myLastReadAtAtOpen]);

  return {
    bottomRef,
    scrollContainerRef,
    unreadDividerRef,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
    showScrollToBottom,
    initialPositionResolved,
    firstUnreadMsgId,
    unreadDisplayCount,
    setHideUnreadDivider,
  };
}
