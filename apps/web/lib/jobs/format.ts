import type { JobStatus } from "./types";

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
 * "Member since Mar 2024" — the month a member joined, in the same UTC
 * convention the rest of this module prints dates in. Null when there is no
 * instant to date (the member row is missing or malformed).
 */
export function memberSinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return `Member since ${new Date(at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })}`;
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
 * The instant a poster's chosen closing date means: the end of that day, UTC.
 *
 * The whole product dates things in UTC already (`timeAgoLabel` prints its
 * dates that way), so a date typed into a form and the date a member reads
 * back are the same day, with no zone rule to state twice. Blank means no
 * deadline.
 */
export function closingInstantFromDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const at = Date.parse(`${date}T23:59:59.999Z`);
  if (!Number.isFinite(at)) return null;

  // The shape check is not enough: this runtime ROLLS AN IMPOSSIBLE DAY OVER
  // rather than rejecting it, so "2026-02-31" parses as 3 March and would be
  // stored as a deadline nobody chose. Only a date that survives the round
  // trip is a date the poster typed.
  const instant = new Date(at);
  if (instant.toISOString().slice(0, 10) !== date) return null;

  return instant.toISOString();
}

/** The closing date a date input holds back — the inverse of the above. */
export function closingDateFromInstant(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * A deadline, and which side of it we are on. The date is printed in the same
 * UTC convention the rest of this module uses, so the day a poster chose is
 * the day every surface reads back.
 */
export type JobDeadline =
  | { kind: "none" }
  | { kind: "open"; label: string }
  | { kind: "expired"; label: string };

export function jobDeadline(
  job: { status: JobStatus; closes_at: string | null },
  now: Date = new Date()
): JobDeadline {
  if (!job.closes_at) return { kind: "none" };
  // The owner ended the posting early, so the date it would have run to says
  // nothing about it any more — "Closes 24 Oct" beside a Closed badge would
  // contradict itself.
  if (job.status === "closed") return { kind: "none" };

  const at = Date.parse(job.closes_at);
  if (!Number.isFinite(at)) return { kind: "none" };

  const day = new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return at <= now.getTime()
    ? { kind: "expired", label: `Expired ${day}` }
    : { kind: "open", label: `Closes ${day}` };
}

/**
 * The two deadline fields a job payload carries. One call, so the label and
 * the expired flag can never come from different instants.
 */
export function deadlineFields(
  job: { status: JobStatus; closes_at: string | null },
  now: Date = new Date()
): { deadline_label: string | null; deadline_expired: boolean } {
  const deadline = jobDeadline(job, now);
  return {
    deadline_label: deadline.kind === "none" ? null : deadline.label,
    deadline_expired: deadline.kind === "expired",
  };
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
