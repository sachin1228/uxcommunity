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

// ─── Optimistic sends ─────────────────────────────────────────────────────

/**
 * The minimal shape of a chat row needed to pair an incoming realtime echo
 * with the optimistic bubble it confirms.
 */
export interface OptimisticLike {
  id: string;
  user_id: string;
  content: string | null;
  status?: "sending" | "sent" | "failed";
}

/**
 * Picks which optimistic bubble an incoming echo replaces.
 *
 * Several sends can be in flight at once, so their echoes can interleave — an
 * echo must land on the bubble it belongs to, otherwise the confirmed row
 * inherits another bubble's local-only fields (the blob: preview URL, the reply
 * preview) and one message looks like it duplicated. Text is the strongest
 * signal available, so an exact content match wins, and the sender's oldest
 * in-flight bubble is the fallback (image/GIF sends carry no text).
 */
export function pickOptimisticMatch<
  T extends OptimisticLike,
>(messages: readonly T[], incoming: { user_id: string; content: string | null }): T | null {
  const inFlight = messages.filter(
    (m) =>
      m.id.startsWith("temp-") &&
      m.user_id === incoming.user_id &&
      m.status === "sending",
  );

  return (
    inFlight.find((m) => (m.content ?? "") === (incoming.content ?? "")) ??
    inFlight[0] ??
    null
  );
}

/**
 * Applies a broadcast comment summary to the timeline card it belongs to.
 *
 * Totals are always absolute (never deltas): a comment API recounts the item
 * before publishing, so a dropped, replayed, or out-of-order event can never
 * drift the number, and deleting a parent comment (which cascades to its
 * replies) stays correct. The newest commenters ride along so the card can name
 * them without a second request; omitting them keeps whatever the card had.
 *
 * Returns `null` when nothing would change, so callers can keep the previous
 * array identity and skip a re-render.
 */
export function applyContentCommentCount<
  T extends {
    id: string;
    meta?: { comment_count?: number | null; comment_users?: string[] | null } | null;
  },
>(events: readonly T[], contentId: string, count: number, commenters?: readonly string[]): T[] | null {
  let changed = false;
  const next = events.map((event) => {
    if (event.id !== contentId) return event;

    const sameCount = (event.meta?.comment_count ?? 0) === count;
    const nextNames = commenters ? [...commenters] : null;
    const sameNames =
      !nextNames ||
      (event.meta?.comment_users ?? []).join("\u0000") === nextNames.join("\u0000");
    if (sameCount && sameNames) return event;

    changed = true;
    return {
      ...event,
      meta: {
        ...(event.meta ?? {}),
        comment_count: count,
        ...(nextNames ? { comment_users: nextNames } : {}),
      },
    };
  });
  return changed ? next : null;
}

/**
 * The byline beside a card's comment count: the people who spoke most recently,
 * newest first (the server caps the list). Returns `null` when there is nobody
 * to name — the card then shows the bare count.
 */
export function formatCommenters(commenters: readonly string[] | null | undefined): string | null {
  const names = (commenters ?? []).map((name) => name.trim()).filter(Boolean);
  return names.length ? names.join(", ") : null;
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
