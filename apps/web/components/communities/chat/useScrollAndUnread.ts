"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
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

// ── Single scroll owner (the only place that writes scrollTop) ─────────────
// How it stays correct across edits: every writer goes through here, and every
// decision is made from "distance from bottom" captured at the moment the
// trigger happens (send / realtime insert / container resize) — never from a
// snapshot taken in an async callback, which is what previously made the
// scroll behaviour break whenever any one of these paths was touched.
// "Sticky at bottom": once the viewport sits within AT_BOTTOM_EPSILON of the
// bottom, it stays glued there until the user scrolls up past STICKY_RELEASE_DIST.
const AT_BOTTOM_EPSILON   = 12;
const STICKY_RELEASE_DIST = 120;

/** Shared bottom-tracking policy — every scroll writer goes through this. */
export interface ScrollControl {
  /** True when the viewport is at (or effectively at) the very bottom. */
  isAtBottom: () => boolean;
  /** True when the user was near enough the bottom that a new row should pin. */
  shouldStick: () => boolean;
  /** Ask the owner (useScrollAndUnread) to pin the viewport to the bottom. */
  stickToBottom: () => void;
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
  // MutableRefObject so the owner component can assign it from a ref callback
  // (remount tracking) — and to match useRealtimeChat's expected type.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const unreadDividerRef   = useRef<HTMLDivElement>(null);

  /**
   * Bottom-tracking policy, consulted by every scroll writer.
   *
   * isAtBottom — distance-from-bottom captured at the moment the decision is
   * made (never from an async rAF/setTimeout snapshot). Handles two edge cases:
   * the user holds the scrollbar thumb at the bottom (dist stays < epsilon)
   * while new messages land, and anchored-viewport layouts where the last
   * child sits fully above the fold (dist = 0 even though the thumb isn't at
   * the absolute bottom).
   *
   * shouldStick — true when the user was genuinely near the bottom of a
   * scrollable chat at trigger time; lets sends from mid-history keep the
   * viewport where it is. Deliberately looser than the scroll-to-bottom pill.
   *
   * stickToBottom() — the ONE entry point for pinning the viewport; callers
   * just flag intent and the owning effects perform the scroll at the right
   * moment.
   */
  const scrollControlRef = useRef<ScrollControl>({
    isAtBottom: () => {
      const container = scrollContainerRef.current;
      if (!container) return true; // nothing mounted → don't block scrolling
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) return true; // fits without scrolling → at bottom
      const distanceFromBottom = maxScroll - container.scrollTop;
      return distanceFromBottom < AT_BOTTOM_EPSILON ||
             (distanceFromBottom < STICKY_RELEASE_DIST &&
               container.scrollHeight - container.scrollTop < container.clientHeight + AT_BOTTOM_EPSILON);
    },
    shouldStick: () => {
      const container = scrollContainerRef.current;
      if (!container) return false;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) return true; // fits without scrolling → stick
      const distanceFromBottom = maxScroll - container.scrollTop;
      return distanceFromBottom < STICKY_RELEASE_DIST ||
             (distanceFromBottom < 250 &&
               container.scrollHeight - container.scrollTop < container.clientHeight + AT_BOTTOM_EPSILON);
    },
    stickToBottom: () => {
      stickToBottomRequestRef.current = true;
    },
  });
  const stickToBottomRequestRef = useRef(false);

  // ── Single bottom-pinning owner: consumes stickToBottom() requests ───────
  // Every scroll writer (sends, GIF sends) merely sets stickToBottomRequestRef
  // via scrollControlRef.stickToBottom(); this layout effect is the only place
  // that consumes it and writes scrollTop, so no two mechanisms can fight
  // (four competing writers were why scroll behaviour kept regressing with
  // every edit). The request is only ever set when shouldStick() was true at
  // trigger time, and no user scroll can happen between the trigger and this
  // same-tick commit — so consuming unconditionally is safe and can never
  // strand a stale request.
  useIsomorphicLayoutEffect(() => {
    if (!stickToBottomRequestRef.current) return;
    stickToBottomRequestRef.current = false;
    if (!initialScrollDoneRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setShowScrollToBottom(false);
  });

  /**
   * Container epoch — incremented whenever the scroll container DOM node is
   * genuinely replaced, i.e. after tab switches mount a fresh container or a
   * hot reload rebuilds the chat shell. Every wiring effect depends on this
   * number, so a remount always re-attaches listeners to the new node instead
   * of silently holding them on a detached element — the classic "worked
   * until someone edited X and tab-switch stopped tracking the bottom"
   * regression class. Attach as `ref={attachScrollContainerRef}` — it has a
   * stable identity, so React only invokes it on real mount/unmount.
   */
  const [containerEpoch, setContainerEpoch] = useState(0);
  const lastContainerNodeRef = useRef<HTMLDivElement | null>(null);

  const attachScrollContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      // Ignore detach (null): a re-attach with the SAME node follows during
      // normal commits, and only a genuinely new node must re-wire effects.
      if (!node || node === lastContainerNodeRef.current) return;
      lastContainerNodeRef.current = node;
      setContainerEpoch((e) => e + 1);
    },
    [],
  );

  // Shared mutable flags (read by useRealtimeChat and scroll effects)
  const initialScrollDoneRef      = useRef(false);
  const realtimeInsertPendingRef  = useRef(false);
  const realtimeWasNearBottomRef  = useRef(false);
  const atBottomRef               = useRef(true);

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
    // Consume the decision captured at realtime-event time (isAtBottom),
    // not a fresh measurement — the insert already grew the content, so a
    // fresh distance check here would always say "not at bottom".
    if (realtimeWasNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowScrollToBottom(true);
    }
  }, [messages]);

  // ── Scroll listener: keeps atBottomRef fresh + pill visibility + dismissal ─
  // Runs on EVERY scroll event (including scrolls we perform ourselves), so
  // atBottomRef always reflects the viewport position at decision time — not
  // a snapshot taken inside an async callback. `containerEpoch` re-runs the
  // wiring when the container DOM node remounts (tab switches, hot reloads):
  // with a bare [] dependency this listener used to stay attached to the
  // detached node, silently killing bottom tracking afterwards.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const dist =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      atBottomRef.current = dist <= AT_BOTTOM_EPSILON;
      setShowScrollToBottom(dist > 80);
      if (dist <= 80 && !hideUnreadDivider && firstUnreadMsgIdRef.current) {
        setHideUnreadDivider(true);
      }
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
    // hideUnreadDivider is intentionally excluded: the listener must not be
    // re-created on dismissal (which would also re-run on every toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEpoch]);

  // ── Reset showScrollToBottom on community change ──────────────────────────
  useEffect(() => {
    setShowScrollToBottom(false);
  }, [communityId]);

  // Latest first-unread id for the scroll listener above — the ref mirrors the
  // derived value without re-subscribing the scroll listener.
  const firstUnreadMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    firstUnreadMsgIdRef.current =
      snapshotReady ? (unreadAtOpenRef.current?.firstMsgId ?? null) : null;
  }, [snapshotReady]);

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
    atBottomRef,
    scrollControlRef,
    unreadAtOpenRef,
    // Scroll state
    showScrollToBottom,
    initialPositionResolved,
    /** Bumped when the scroll container node is replaced — re-wires effects. */
    containerEpoch,
    /** Stable ref callback for the scroll container (tracks node replacement). */
    attachScrollContainerRef,
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
