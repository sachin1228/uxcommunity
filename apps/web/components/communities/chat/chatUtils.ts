// ─── Shared chat utilities ────────────────────────────────────────────────

/** Maximum characters allowed in a chat message — the composer hard limit. */
export const MAX_MESSAGE_CHARS = 500;

// Locale shared with the sidebar timestamps (lib/communities/sidebar-time.ts).
// The chat previously formatted with en-IN while the sidebar used en-US, so
// the same message read "6:03 pm" in the window and "6:03 PM" in the list.
const TIME_LOCALE = "en-US";
const DATE_LOCALE = "en-US";

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(TIME_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(DATE_LOCALE, { month: "short", day: "numeric" });
}

// ─── Scroll helpers ───────────────────────────────────────────────────────

/**
 * The minimal surface of a scrollable element this module needs.
 *
 * Structural rather than `HTMLElement` so the send path can be exercised in
 * unit tests without a DOM.
 */
export interface ScrollableLike {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Pins a chat scroll container to its newest message.
 *
 * Deliberately unconditional: a message the user just sent is always the thing
 * they expect to see next, so the view jumps to the bottom even when they had
 * scrolled far up into history. An earlier "only when already near the bottom"
 * check (sentinel top within ~250px of the viewport) left senders parked in old
 * history with their own message invisible below the fold.
 */
export function scrollChatToBottom(
  container: ScrollableLike | null | undefined,
): void {
  if (!container) return;
  // Explicit max offset rather than leaning on the browser's clamp, so the
  // landing position is exact (and the assignment fires the scroll event that
  // hides the "jump to latest" pill and dismisses the unread divider). A chat
  // shorter than its viewport has no scrollable range and clamps to the top.
  container.scrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight,
  );
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(DATE_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
