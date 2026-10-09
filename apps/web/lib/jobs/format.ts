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

/**
 * The stamp to show when a posting was edited after it was published, or null
 * when it was never edited. The database only moves `updated_at` on a save
 * that actually changed a field and never sets it at creation, so "no edit"
 * stays distinguishable from "edited at the moment it was posted" — and a
 * posting can never advertise an edit that did not happen. An edit that lands
 * in the same instant as the creation is treated as no edit.
 */
export function editedLabel(createdAt: string, updatedAt: string | null): string | null {
  if (!updatedAt) return null;

  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return null;
  if (updated <= created) return null;

  return `Updated ${timeAgoLabel(updatedAt)}`;
}

/**
 * The years range inside an experience label ("Mid-level Designers (3-5 years)"
 * → "(3-5 years)") for surfaces that show it beside the role title. Falls back
 * to the full label when it carries no parenthetical, so an admin-edited label
 * still shows something true.
 */
export function experienceYearsLabel(label: string): string {
  const match = label.match(/\(([^)]+)\)\s*$/);
  return match ? `(${match[1]})` : label;
}
