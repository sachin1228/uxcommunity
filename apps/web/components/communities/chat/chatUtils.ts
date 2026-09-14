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
