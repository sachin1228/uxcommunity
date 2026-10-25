"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { CachedMessage } from "@/lib/communities/cache";
import { oldestRealCursor, type MessageCursor } from "@/lib/communities/messages";
import { anchorOffset, scrollAnchorDelta, type ScrollAnchor } from "./chatUtils";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** A reader this close to the newest row is still reading the newest row. */
const BOTTOM_PIN_PX = 80;
/** Where inside the viewport we probe for the top row a reader is looking at. */
const ANCHOR_PROBE_INSET_PX = 8;

interface UseMessageListAnchorOptions {
  communityId: string;
  messages: CachedMessage[];
  hasMoreAbove: boolean;
  loadingOlder: boolean;
  loading: boolean;
  /** Loads the page above the given compound cursor. */
  fetchOlderMessages: (before: MessageCursor) => Promise<void>;
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
      if (!hasMoreAbove || loadingOlder) return;
      // Both halves of the cursor, taken under the server's own total order
      // (created_at, id) so the page above can never skip an equal-timestamp
      // row that shares the oldest message's timestamp.
      const before = oldestRealCursor(messages);
      if (!before) return;
      void fetchOlderMessages(before);
    };
  });

  // ── Scroll preservation for changes above the viewport ────────────────────
  // Anything that changes height *above* the messages the user is looking at
  // (older pages being prepended, the load-older slot disappearing once the
  // history is exhausted, an image above the viewport finishing its load) must
  // be compensated for so the visible messages stay exactly where they are —
  // the way WhatsApp behaves.
  //
  // The anchor is the message at the TOP of the viewport, not the oldest loaded
  // message: a chat image gets its height only when it decodes, so a late load
  // anywhere between the oldest row and the reader's position would otherwise
  // move everything below it. Anchoring on what the reader is actually looking
  // at means any height inserted above that row is compensated for, whichever
  // bubble it happened in.
  //
  // Implementation: record the anchor element's offset from the top of the
  // scroll content (independent of the current scrollTop) after every commit
  // and after scroll settles. Any change in that offset is exactly the height
  // inserted or removed above it; add it back to scrollTop before paint. A
  // ResizeObserver applies the same correction for height changes that happen
  // without a React commit (a media element decoding, a font swapping in).
  // Because we measure the anchor rather than the total scrollHeight, height
  // changes below the anchor — a new message, a reaction pill — can never leak
  // into the correction. Browser scroll anchoring is disabled on the container
  // so the two mechanisms can't fight each other.
  const oldestRealMsgId = useMemo(
    () => messages.find((message) => !message.id.startsWith("temp-"))?.id ?? null,
    [messages],
  );
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
  /** The reader was at the newest row before the current layout change. */
  const pinnedToBottomRef = useRef(false);

  const measureAnchorOffset = useCallback(
    (container: HTMLElement, id: string): number | null => {
      const el = container.querySelector<HTMLElement>(
        `[data-message-id="${id}"]`,
      );
      if (!el) return null;
      return anchorOffset(
        el.getBoundingClientRect().top,
        container.getBoundingClientRect().top,
        container.scrollTop,
      );
    },
    [],
  );

  /**
   * The message row at the viewport's top edge. `elementFromPoint` answers it in
   * O(1) for the common case (the probe lands on a row); a binary search over
   * the DOM-ordered rows covers the gaps between groups and date pills. The
   * DOM order is the visual order here — the web list is not virtualized and
   * renders oldest first.
   */
  const pickAnchorId = useCallback((container: HTMLElement): string | null => {
    const rect = container.getBoundingClientRect();
    if (rect.height <= 0) return null;

    if (typeof document !== "undefined" && typeof document.elementFromPoint === "function") {
      const probeY = Math.min(rect.bottom - 1, rect.top + ANCHOR_PROBE_INSET_PX);
      const hit = document.elementFromPoint(
        rect.left + Math.min(ANCHOR_PROBE_INSET_PX, rect.width / 2),
        probeY,
      );
      const row = hit?.closest<HTMLElement>("[data-message-id]");
      if (row && container.contains(row)) return row.dataset.messageId ?? null;
    }

    const rows = container.querySelectorAll<HTMLElement>("[data-message-id]");
    let low = 0;
    let high = rows.length - 1;
    let found: HTMLElement | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const row = rows[middle];
      if (!row) break;
      if (row.getBoundingClientRect().bottom > rect.top) {
        found = row;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
    return found?.dataset.messageId ?? null;
  }, []);

  // A community switch starts from a clean slate so the first paint of the new
  // chat is never treated as a "prepend" onto the previous one. Declared before
  // the compensation effect so it runs first within the same commit.
  useIsomorphicLayoutEffect(() => {
    scrollAnchorRef.current = null;
  }, [communityId]);

  // No dependency array on purpose: any commit can change what sits above the
  // anchor (messages, hasMoreAbove, threadEvents, unread divider…), and a
  // single elementFromPoint + two getBoundingClientRect calls per commit is
  // cheap.
  useIsomorphicLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // While the initial position is still being resolved the list is hidden
    // and useScrollAndUnread owns scrollTop — don't compete with it.
    if (!initialPositionResolved) return;

    const prev = scrollAnchorRef.current;
    if (prev) {
      // delta is the height inserted (+) or removed (−) above the anchor;
      // null (the element left the list) means there is nothing to correct.
      const delta = scrollAnchorDelta(prev, measureAnchorOffset(container, prev.id));
      if (delta !== 0) container.scrollTop += delta;
    }

    // Re-anchor on the row now at the top of the viewport.
    const nextId = pickAnchorId(container) ?? oldestRealMsgId;
    const offset = nextId ? measureAnchorOffset(container, nextId) : null;
    scrollAnchorRef.current = nextId && offset !== null ? { id: nextId, offset } : null;
  });

  // Keep the anchor pointed at what the reader is looking at as they scroll,
  // and remember whether they were parked at the newest row: a media element
  // finishing its load there should keep them at the newest row rather than
  // holding a position that has just slid up.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      pinnedToBottomRef.current =
        container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_PIN_PX;
      if (!initialPositionResolved) return;
      const nextId = pickAnchorId(container) ?? oldestRealMsgId;
      const offset = nextId ? measureAnchorOffset(container, nextId) : null;
      scrollAnchorRef.current = nextId && offset !== null ? { id: nextId, offset } : null;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    container.addEventListener("scroll", schedule, { passive: true });
    return () => {
      container.removeEventListener("scroll", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [
    communityId,
    initialPositionResolved,
    measureAnchorOffset,
    pickAnchorId,
    scrollContainerRef,
    oldestRealMsgId,
  ]);

  // Height changes that do not come from a React commit — images and GIFs
  // decoding, fonts settling — are corrected by the same anchor rule. Applying
  // the correction inside the callback (not on the next frame) is what keeps
  // the jump from ever reaching the screen.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = container?.firstElementChild;
    if (!container || !content || typeof ResizeObserver === "undefined") return;

    const correct = () => {
      if (!initialPositionResolved) return;
      if (pinnedToBottomRef.current) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      const anchor = scrollAnchorRef.current;
      if (!anchor) return;
      const offset = measureAnchorOffset(container, anchor.id);
      if (offset === null) return;
      const delta = scrollAnchorDelta(anchor, offset);
      if (delta !== 0) container.scrollTop += delta;
      // Scroll does not change an element's offset inside the content, so the
      // fresh measurement is the new snapshot.
      anchor.offset = offset;
    };

    const ro = new ResizeObserver(correct);
    ro.observe(content);
    return () => ro.disconnect();
  }, [communityId, loading, initialPositionResolved, measureAnchorOffset, scrollContainerRef]);

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
