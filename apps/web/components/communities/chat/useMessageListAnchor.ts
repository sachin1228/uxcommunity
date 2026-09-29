"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { CachedMessage } from "@/lib/communities/cache";
import { anchorOffset, scrollAnchorDelta, type ScrollAnchor } from "./chatUtils";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface UseMessageListAnchorOptions {
  communityId: string;
  messages: CachedMessage[];
  hasMoreAbove: boolean;
  loadingOlder: boolean;
  loading: boolean;
  fetchOlderMessages: (before: string) => Promise<void>;
  /** Owned by useScrollAndUnread — the scrollable message body. */
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** False while useScrollAndUnread is still resolving the initial position. */
  initialPositionResolved: boolean;
}

/**
 * Owns the two scroll-position mechanisms of the message list:
 *
 * 1. Load-older triggering — an IntersectionObserver on a top sentinel that
 *    starts fetching the previous page before the user reaches the top.
 * 2. Scroll preservation for changes above the viewport.
 */
export function useMessageListAnchor({
  communityId,
  messages,
  hasMoreAbove,
  loadingOlder,
  loading,
  fetchOlderMessages,
  scrollContainerRef,
  initialPositionResolved,
}: UseMessageListAnchorOptions) {
  // ── Top-sentinel ref — observed by IntersectionObserver to load older messages.
  const topSentinelRef   = useRef<HTMLDivElement>(null);
  /** Always points to the latest load-older logic; never stale inside event handlers. */
  const loadOlderCallbackRef = useRef<(() => void) | null>(null);

  // Keep the callback ref current on every render (no deps needed).
  useEffect(() => {
    loadOlderCallbackRef.current = () => {
      const oldest = messages.find((m) => !m.id.startsWith("temp-"));
      if (!oldest || !hasMoreAbove || loadingOlder) return;
      fetchOlderMessages(oldest.created_at);
    };
  });

  // ── Scroll preservation for changes above the viewport ────────────────────
  // Anything that changes height *above* the messages the user is looking at
  // (older pages being prepended, the load-older slot disappearing once the
  // history is exhausted) must be compensated for so the visible messages stay
  // exactly where they are — the way WhatsApp behaves.
  //
  // Implementation: we use the oldest *real* message as a scroll anchor. After
  // every commit we record that element's offset from the top of the scroll
  // content (independent of the current scrollTop). On the next commit, if the
  // same element is still in the DOM, any change in that offset is exactly the
  // amount of height that was inserted or removed above it — older messages,
  // the load-older slot, a date pill that became a real boundary, a thread
  // notification — so we add it to scrollTop before paint. Because we measure
  // the anchor rather than the total scrollHeight, height changes *below* the
  // anchor (images loading, reactions, thread events arriving) can never leak
  // into the correction. Browser scroll anchoring is disabled on the container
  // so the two mechanisms can't fight each other.
  const oldestRealMsgId = useMemo(
    () => messages.find((m) => !m.id.startsWith("temp-"))?.id ?? null,
    [messages],
  );
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);

  const measureAnchorOffset = (container: HTMLElement, id: string): number | null => {
    const el = container.querySelector<HTMLElement>(
      `[data-message-id="${id}"]`,
    );
    if (!el) return null;
    return anchorOffset(
      el.getBoundingClientRect().top,
      container.getBoundingClientRect().top,
      container.scrollTop,
    );
  };

  // A community switch starts from a clean slate so the first paint of the new
  // chat is never treated as a "prepend" onto the previous one. Declared before
  // the compensation effect so it runs first within the same commit.
  useIsomorphicLayoutEffect(() => {
    scrollAnchorRef.current = null;
  }, [communityId]);

  // No dependency array on purpose: any commit can change what sits above the
  // anchor (messages, hasMoreAbove, threadEvents, unread divider…), and a
  // single querySelector + two getBoundingClientRect calls per commit is cheap.
  useIsomorphicLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // While the initial position is still being resolved the list is hidden
    // and useScrollAndUnread owns scrollTop — don't compete with it.
    if (initialPositionResolved) {
      const prev = scrollAnchorRef.current;
      if (prev) {
        // delta is the height inserted (+) or removed (−) above the anchor;
        // null (the element left the list) means there is nothing to correct.
        const delta = scrollAnchorDelta(prev, measureAnchorOffset(container, prev.id));
        if (delta !== 0) container.scrollTop += delta;
      }
    }

    // Re-anchor on the (possibly new) oldest real message.
    if (oldestRealMsgId) {
      const offset = measureAnchorOffset(container, oldestRealMsgId);
      scrollAnchorRef.current = offset === null ? null : { id: oldestRealMsgId, offset };
    } else {
      scrollAnchorRef.current = null;
    }
  });

  // The anchor's stored offset must also track height changes that happen
  // *without* a React commit (e.g. an avatar or image above it finishing its
  // load). A ResizeObserver on the list content refreshes the snapshot so a
  // later prepend never applies a stale delta.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const anchor = scrollAnchorRef.current;
      if (!anchor) return;
      const offset = measureAnchorOffset(container, anchor.id);
      if (offset !== null) anchor.offset = offset;
    });
    ro.observe(content);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, loading]);

  // IntersectionObserver-based trigger: starts loading older messages before
  // the user reaches the top by using a 300 px rootMargin.  Including
  // `loading` and `loadingOlder` in the deps ensures the observer is
  // (re-)created once the initial load finishes and the sentinel first
  // appears in the DOM, and again after each older-page fetch completes.
  // Stops observing automatically once hasMoreAbove becomes false.
  useEffect(() => {
    if (!hasMoreAbove) return;

    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadOlderCallbackRef.current?.();
        }
      },
      {
        root: scrollContainerRef.current,
        // Fire 300 px before the sentinel reaches the viewport top so
        // older messages start loading well before the user gets there.
        rootMargin: "300px 0px 0px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // scrollContainerRef is a stable ref — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMoreAbove, loadingOlder, loading]);

  return { topSentinelRef };
}
