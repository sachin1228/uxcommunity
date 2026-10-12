"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { anchorOffset, scrollAnchorDelta, type ScrollAnchor } from "@/components/communities/chat/chatUtils";
import type { DmMessage } from "@/lib/direct-messages/types";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Scroll-position mechanics of the DM message list — the community chat's
 * useMessageListAnchor ported to a conversation key: a top sentinel that
 * triggers loading older pages 300 px early, and anchor-based compensation so
 * height inserted above the viewport (a prepended page, the sentinel slot
 * disappearing) never moves the messages the reader is looking at.
 */
export function useDmMessageListAnchor({
  conversationId,
  messages,
  hasMoreAbove,
  loadingOlder,
  loading,
  fetchOlderMessages,
  scrollContainerRef,
  initialPositionResolved,
}: {
  conversationId: string | null;
  messages: DmMessage[];
  hasMoreAbove: boolean;
  loadingOlder: boolean;
  loading: boolean;
  fetchOlderMessages: (before: string) => Promise<void>;
  scrollContainerRef: RefObject<HTMLDivElement>;
  initialPositionResolved: boolean;
}) {
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const loadOlderCallbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadOlderCallbackRef.current = () => {
      const oldest = messages.find((m) => !m.id.startsWith("temp-"));
      if (!oldest || !hasMoreAbove || loadingOlder) return;
      void fetchOlderMessages(oldest.created_at);
    };
  });

  const oldestRealMsgId = useMemo(
    () => messages.find((m) => !m.id.startsWith("temp-"))?.id ?? null,
    [messages],
  );
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);

  const measureAnchorOffset = (container: HTMLElement, id: string): number | null => {
    const el = container.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!el) return null;
    return anchorOffset(
      el.getBoundingClientRect().top,
      container.getBoundingClientRect().top,
      container.scrollTop,
    );
  };

  useIsomorphicLayoutEffect(() => {
    scrollAnchorRef.current = null;
  }, [conversationId]);

  // No dependency array: any commit can change what sits above the anchor.
  useIsomorphicLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (initialPositionResolved) {
      const prev = scrollAnchorRef.current;
      if (prev) {
        const delta = scrollAnchorDelta(prev, measureAnchorOffset(container, prev.id));
        if (delta !== 0) container.scrollTop += delta;
      }
    }

    if (oldestRealMsgId) {
      const offset = measureAnchorOffset(container, oldestRealMsgId);
      scrollAnchorRef.current = offset === null ? null : { id: oldestRealMsgId, offset };
    } else {
      scrollAnchorRef.current = null;
    }
  });

  // Track height changes without a React commit (images/avatars loading above
  // the anchor) so a later prepend never applies a stale delta.
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
  }, [conversationId, loading]);

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
        rootMargin: "300px 0px 0px 0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMoreAbove, loadingOlder, loading]);

  return { topSentinelRef };
}
