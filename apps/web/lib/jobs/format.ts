/**
 * Relative labels for job timestamps. Computed on the server before
 * rendering, so the SSR output and the hydrated client output are the same
 * string — a live "x minutes ago" clock would drift between the two.
 */
export function timeAgoLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
