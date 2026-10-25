/**
 * When the chat list is allowed to show its scrollbar.
 *
 * THE PROBLEM
 *   Android draws a scrollbar as `viewport height / content height`, and a
 *   virtualized list has only laid out `initialNumToRender` rows (8) on the
 *   frame the chat paints. The rest arrive in batches — `maxToRenderPerBatch`
 *   4, every `updateCellsBatchingPeriod` 50 ms (lib/homeFeed). So for the first
 *   half second the list truthfully reports "I am about one screen tall", the
 *   thumb is drawn at almost full length, and it rescales on every batch until
 *   the window it keeps mounted is measured. Nothing about the conversation
 *   changed; only what the list has measured.
 *
 *   WhatsApp's bar appears once, already the right length, because its rows are
 *   laid out from the local store before the screen paints. The closest we get
 *   without giving up virtualization is to keep our bar off until the content
 *   height stops moving, then let it in: one correct bar instead of a visible
 *   rescale.
 *
 * SCOPE
 *   The initial mount only. Pagination and new messages grow the content later,
 *   and hiding the bar then would take away the very thing the reader is using
 *   to judge where they are.
 */

/** Quiet period after the last content-size change before the bar may show. */
export const CHAT_SCROLL_INDICATOR_SETTLE_MS = 180;

/**
 * Ceiling on the wait. A window of cached history can keep the list mounting
 * rows for well over a second; past this the bar is shown anyway rather than
 * staying invisible behind a list that never goes quiet.
 */
export const CHAT_SCROLL_INDICATOR_MAX_DELAY_MS = 2000;

export interface ChatScrollIndicatorGate {
  /**
   * The list reported a content height (`onContentSizeChange`). Every call
   * restarts the settle clock, so the bar waits for the last batch.
   */
  measure(height: number): void;
  /** Cancel a pending reveal — unmount. */
  dispose(): void;
}

export interface ChatScrollIndicatorGateOptions {
  /** Called once, when the bar may be shown. */
  onReveal: () => void;
  settleMs?: number;
  maxDelayMs?: number;
}

export function createChatScrollIndicatorGate({
  onReveal,
  settleMs = CHAT_SCROLL_INDICATOR_SETTLE_MS,
  maxDelayMs = CHAT_SCROLL_INDICATOR_MAX_DELAY_MS,
}: ChatScrollIndicatorGateOptions): ChatScrollIndicatorGate {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let revealed = false;
  let startedAt: number | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reveal() {
    if (revealed) return;
    clearTimer();
    revealed = true;
    onReveal();
  }

  return {
    measure(height) {
      if (revealed) return;
      // An empty list has no bar to draw and nothing to wait for — a zero
      // height would otherwise start a clock that resolves to a useless reveal.
      if (!Number.isFinite(height) || height <= 0) return;

      const now = Date.now();
      if (startedAt === null) startedAt = now;

      clearTimer();
      const budget = maxDelayMs - (now - startedAt);
      if (budget <= 0) {
        reveal();
        return;
      }
      timer = setTimeout(reveal, Math.min(settleMs, budget));
    },

    dispose() {
      clearTimer();
    },
  };
}
