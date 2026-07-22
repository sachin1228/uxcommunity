"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  MutableRefObject,
} from "react";
import { msgCache, sidebarStore, lastReadAtOnOpen } from "@/lib/communities/cache";
import type { CachedMessage } from "@/lib/communities/cache";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Message = CachedMessage;

interface UseScrollAndUnreadOptions {
  communityId: string;
  currentUserId: string;
  messages: Message[];
  loading: boolean;
  initialMessagesReady: boolean;
  /** Seed from SSR — pass the prop value through; undefined = not yet known. */
  initialLastReadAtFromSSR?: string | null;
}

export function useScrollAndUnread({
  communityId,
  currentUserId,
  messages,
  loading,
  initialMessagesReady,
  initialLastReadAtFromSSR,
}: UseScrollAndUnreadOptions) {
  // ── Scroll refs ───────────────────────────────────────────────────────────
  const bottomRef          = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const unreadDividerRef   = useRef<HTMLDivElement>(null);

  // Shared mutable flags (read by useRealtimeChat and scroll effects)
  const initialScrollDoneRef      = useRef(false);
  const realtimeInsertPendingRef  = useRef(false);
  const realtimeWasNearBottomRef  = useRef(false);

  // ── Scroll UI state ───────────────────────────────────────────────────────
  const [showScrollToBottom,      setShowScrollToBottom]      = useState(false);
  const [initialPositionResolved, setInitialPositionResolved] = useState(false);

  // ── Unread state ──────────────────────────────────────────────────────────
  const [lastReadAt,       setLastReadAt]       = useState<string | null | undefined>(undefined);
  const [snapshotReady,    setSnapshotReady]    = useState(false);
  const [hideUnreadDivider, setHideUnreadDivider] = useState(false);

  const unreadAtOpenRef = useRef<{ firstMsgId: string | null; count: number } | null>(null);

  // ── Fast-path: compute unread snapshot from cache before first paint ──────
  // Runs on every communityId change to reset + pre-compute from existing cache.
  useIsomorphicLayoutEffect(() => {
    initialScrollDoneRef.current = false;
    unreadAtOpenRef.current = null;
    setHideUnreadDivider(false);
    setSnapshotReady(false);
    setInitialPositionResolved(false);

    const cachedMsgs          = msgCache.get(communityId);
    const hasOpeningLastReadAt = lastReadAtOnOpen.has(communityId);
    if (!cachedMsgs?.length || !hasOpeningLastReadAt) return;

    const openingLastReadAt = lastReadAtOnOpen.get(communityId) ?? null;
    lastReadAtOnOpen.delete(communityId);
    setLastReadAt(openingLastReadAt);

    const sidebarEntry_      = sidebarStore.data?.communities.find((c) => c.id === communityId);
    const sidebarUnreadCount = sidebarEntry_?.message_count ?? 0;
    const lastReadTime       = openingLastReadAt === null
      ? -Infinity
      : new Date(openingLastReadAt).getTime();

    const unreadMsgs = cachedMsgs.filter(
      (m) =>
        !m.id.startsWith("temp-") &&
        m.user_id !== currentUserId &&
        new Date(m.created_at).getTime() > lastReadTime
    );
    if (sidebarUnreadCount > 0 && unreadMsgs.length === 0) return;
    if (unreadMsgs.length === 0) return;

    unreadAtOpenRef.current = {
      firstMsgId: unreadMsgs[0]?.id ?? null,
      count: unreadMsgs.length,
    };
    setSnapshotReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  // ── Effect 1: Unread boundary snapshot (slow-path, after data loads) ──────
  useEffect(() => {
    if (!initialMessagesReady) return;
    if (snapshotReady) return;

    if (lastReadAt === undefined) {
      // Check if panel already wrote lastReadAt to the shared map
      if (lastReadAtOnOpen.has(communityId)) {
        setLastReadAt(lastReadAtOnOpen.get(communityId) ?? null);
        lastReadAtOnOpen.delete(communityId);
        return;
      }
      // If SSR prop was provided, use it
      if (initialLastReadAtFromSSR !== undefined) {
        setLastReadAt(initialLastReadAtFromSSR);
        return;
      }
      // Wait up to 800ms for panel to write lastReadAt
      const timer = setTimeout(() => {
        if (lastReadAtOnOpen.has(communityId)) {
          setLastReadAt(lastReadAtOnOpen.get(communityId) ?? null);
          lastReadAtOnOpen.delete(communityId);
        } else {
          setLastReadAt(null);
        }
      }, 800);
      return () => clearTimeout(timer);
    }

    const realMsgs    = messages.filter((m) => !m.id.startsWith("temp-"));
    const lastReadTime = lastReadAt === null ? -Infinity : new Date(lastReadAt).getTime();
    const unreadMsgs  = realMsgs.filter(
      (m) =>
        m.user_id !== currentUserId &&
        new Date(m.created_at).getTime() > lastReadTime
    );
    unreadAtOpenRef.current = {
      firstMsgId: unreadMsgs[0]?.id ?? null,
      count: unreadMsgs.length,
    };
    setSnapshotReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessagesReady, lastReadAt, communityId, snapshotReady]);

  // ── Effect 2: Initial scroll to unread boundary ───────────────────────────
  useIsomorphicLayoutEffect(() => {
    if (!snapshotReady) return;
    if (loading) return;
    if (initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;

    const container = scrollContainerRef.current;
    if (!container) {
      setInitialPositionResolved(true);
      return;
    }
    const isOverflowing = container.scrollHeight > container.clientHeight;
    if (!isOverflowing) {
      setInitialPositionResolved(true);
      return;
    }
    const divider = unreadDividerRef.current;
    if (divider && unreadAtOpenRef.current?.firstMsgId) {
      const dividerRect   = divider.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const dividerTop    = dividerRect.top - containerRect.top + container.scrollTop;
      container.scrollTop = Math.max(0, dividerTop - 80);
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
    setInitialPositionResolved(true);
  }, [snapshotReady, loading, communityId]);

  // ── Effect 3: Realtime auto-scroll ───────────────────────────────────────
  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    if (!realtimeInsertPendingRef.current) return;
    realtimeInsertPendingRef.current = false;
    if (realtimeWasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowScrollToBottom(true);
    }
  }, [messages]);

  // ── Scroll-to-bottom button visibility ───────────────────────────────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const dist =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollToBottom(dist > 80);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // ── Reset showScrollToBottom on community change ──────────────────────────
  useEffect(() => {
    setShowScrollToBottom(false);
  }, [communityId]);

  // ── Derived unread values ─────────────────────────────────────────────────
  const realMessages = useMemo(
    () => messages.filter((m) => !m.id.startsWith("temp-")),
    [messages]
  );

  const firstUnreadMsgId: string | null =
    snapshotReady && !hideUnreadDivider
      ? (unreadAtOpenRef.current?.firstMsgId ?? null)
      : null;

  const unreadDisplayCount = useMemo(() => {
    if (!snapshotReady || lastReadAt === undefined) return 0;
    return realMessages.filter(
      (m) =>
        m.user_id !== currentUserId &&
        (lastReadAt === null ||
          new Date(m.created_at).getTime() > new Date(lastReadAt).getTime())
    ).length;
  }, [snapshotReady, lastReadAt, realMessages, currentUserId]);

  return {
    // Refs
    bottomRef,
    scrollContainerRef,
    unreadDividerRef,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
    unreadAtOpenRef,
    // Scroll state
    showScrollToBottom,
    initialPositionResolved,
    // Unread state
    lastReadAt,
    snapshotReady,
    hideUnreadDivider,
    setHideUnreadDivider,
    // Derived
    firstUnreadMsgId,
    unreadDisplayCount,
  };
}
