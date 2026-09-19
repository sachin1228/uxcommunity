/**
 * The weekly competition cycle.
 *
 * One definition of "when is a competition live, closed, or finished", shared
 * by the API (validation), the pages (what to render), and the admin tools
 * (derived status, never hand-set). `public.competition_status()` in
 * migration 20260919120000_weekly_designer_competitions.sql is the matching
 * SQL version.
 *
 * The cycle:
 *
 *   Sunday 00:00   →  Friday 18:00    live           submit + vote
 *   Friday 18:00   →  Saturday 00:00  voting_closed  final submissions in, voting continues
 *   Saturday 00:00 →  next Sunday     results        winner, stats, archive-ready
 *   next Sunday 00:00                 archived       previous cycle joins the history
 *
 * Every timestamp is stored in UTC. The weekly boundaries are generated in
 * `COMPETITIONS_TIMEZONE` (default UTC) so "Sunday" is one instant for the
 * whole community instead of whatever the visitor's browser happens to think.
 */

export const COMPETITION_STATUSES = [
  "upcoming",
  "live",
  "voting_closed",
  "results",
  "archived",
] as const;

export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const COMPETITION_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type CompetitionDifficulty = (typeof COMPETITION_DIFFICULTIES)[number];

/** The four timestamps that define one weekly cycle. */
export interface CycleWindows {
  start_at: string;
  submission_deadline: string;
  voting_deadline: string;
  results_at: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** How a week is laid out relative to its Sunday 00:00 anchor. */
export const WEEK_CYCLE_OFFSETS = {
  /** Sunday 00:00 — the challenge drops. */
  startMs: 0,
  /** Friday 18:00 — final submissions. */
  submissionDeadlineMs: 5 * DAY_MS + 18 * HOUR_MS,
  /** Saturday 00:00 — voting closes and results day begins. */
  votingDeadlineMs: 6 * DAY_MS,
  resultsMs: 6 * DAY_MS,
} as const;

/** The default app timezone for cycle boundaries. */
export function competitionsTimeZone(): string {
  return process.env.COMPETITIONS_TIMEZONE?.trim() || "UTC";
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

/**
 * The lifecycle status of a competition, derived purely from its timestamps.
 *
 * `archivedAt` is the one admin-set timestamp in the model, and even that is a
 * timestamp rather than a flag: once it passes, the cycle is history.
 */
export function deriveCompetitionStatus(
  windows: CycleWindows,
  now: Date = new Date(),
  archivedAt?: string | null,
): CompetitionStatus {
  const at = now.getTime();

  if (archivedAt) {
    const archived = Date.parse(archivedAt);
    if (Number.isFinite(archived) && archived <= at) return "archived";
  }

  if (at < Date.parse(windows.start_at)) return "upcoming";
  if (at < Date.parse(windows.submission_deadline)) return "live";
  if (at < Date.parse(windows.voting_deadline)) return "voting_closed";
  return "results";
}

/** Entries may be created or edited while the challenge is live. */
export function canSubmitEntry(status: CompetitionStatus): boolean {
  return status === "live";
}

/** Voting runs the whole week and stops when the cycle closes. */
export function canVote(status: CompetitionStatus): boolean {
  return status === "live" || status === "voting_closed";
}

/**
 * Discussion stays open while a cycle is visible — including results day, so
 * people can talk about the work being celebrated. An archived cycle is frozen
 * history and takes no new comments.
 */
export function canComment(status: CompetitionStatus): boolean {
  return status !== "upcoming" && status !== "archived";
}

/** Results (winner, stats, top entries) are public from results day onward. */
export function hasPublishedResults(status: CompetitionStatus): boolean {
  return status === "results" || status === "archived";
}

/**
 * Ranking by votes is only meaningful once voting has closed. Showing a live
 * leaderboard mid-competition invites gaming, so galleries sort by recency
 * until then (the API refuses `sort=votes` while voting is open).
 */
export function canRankByVotes(status: CompetitionStatus): boolean {
  return !canVote(status);
}

export function isUpcoming(status: CompetitionStatus): boolean {
  return status === "upcoming";
}

/**
 * The gallery sort the API will honour for a given status. A vote-ordered list
 * while voting is open would hand voters a scoreboard to game, so until the
 * cycle closes the gallery stays chronological.
 */
export function resolveEntrySort(requested: string | null, status: CompetitionStatus): string {
  const allowed = canRankByVotes(status)
    ? new Set(["recent", "oldest", "votes", "featured"])
    : new Set(["recent", "oldest", "featured"]);
  if (requested && allowed.has(requested)) return requested;
  return "recent";
}

/** Human label for the status chip. */
export function statusLabel(status: CompetitionStatus): string {
  switch (status) {
    case "upcoming":
      return "Starts soon";
    case "live":
      return "Live now";
    case "voting_closed":
      return "Final votes";
    case "results":
      return "Results are in";
    case "archived":
      return "Archived";
  }
}

// ---------------------------------------------------------------------------
// Cycle generation
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock parts of `date` in `timeZone`. Null when the zone is unknown. */
export function zonedParts(date: Date, timeZone: string): ZonedParts | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
    const parsed: ZonedParts = {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      hour: value("hour") % 24,
      minute: value("minute"),
      second: value("second"),
    };

    return Object.values(parsed).some((part) => Number.isNaN(part)) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * The UTC instant for a wall-clock time in `timeZone`.
 *
 * The offset is looked up twice because the first guess can land on the far
 * side of a DST transition — the second pass uses the offset actually in
 * effect at the resolved instant. Zones without DST (UTC, Asia/Kolkata) settle
 * in one step.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone = competitionsTimeZone(),
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const offsetAt = (instantMs: number): number => {
    const parts = zonedParts(new Date(instantMs), timeZone);
    if (!parts) return 0;
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0,
    );
    return asUtc - (instantMs - (instantMs % 1000));
  };

  let resolved = guess - offsetAt(guess);
  resolved = guess - offsetAt(resolved);
  return new Date(resolved);
}

/**
 * The Sunday 00:00 that anchors the cycle containing `now`.
 *
 * Sunday is day 0 in the local week, so the anchor is `now` minus its local
 * weekday, keeping the local calendar date (which is what makes the boundary
 * land on Sunday midnight in the configured zone).
 */
export function cycleAnchorFor(now: Date = new Date(), timeZone = competitionsTimeZone()): Date {
  const parts = zonedParts(now, timeZone);
  // Unknown timezone → fall back to UTC so the page still renders a cycle.
  if (!parts) return utcAnchorFor(now);

  const localDateUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const dow = new Date(localDateUtc).getUTCDay();
  const anchorDay = new Date(localDateUtc - dow * DAY_MS);

  return zonedTimeToUtc(
    anchorDay.getUTCFullYear(),
    anchorDay.getUTCMonth() + 1,
    anchorDay.getUTCDate(),
    0,
    0,
    timeZone,
  );
}

function utcAnchorFor(now: Date): Date {
  const dayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = new Date(dayUtc).getUTCDay();
  return new Date(dayUtc - dow * DAY_MS);
}

/**
 * The four timestamps of the weekly cycle anchored on `anchor` (a Sunday
 * 00:00). The next cycle starts exactly seven days later, which is what moves
 * the previous competition into the archive.
 */
export function weeklyCycleFrom(anchor: Date): CycleWindows {
  return {
    start_at: new Date(anchor.getTime() + WEEK_CYCLE_OFFSETS.startMs).toISOString(),
    submission_deadline: new Date(
      anchor.getTime() + WEEK_CYCLE_OFFSETS.submissionDeadlineMs,
    ).toISOString(),
    voting_deadline: new Date(anchor.getTime() + WEEK_CYCLE_OFFSETS.votingDeadlineMs).toISOString(),
    results_at: new Date(anchor.getTime() + WEEK_CYCLE_OFFSETS.resultsMs).toISOString(),
  };
}

/** The cycle after `anchor` — the "next Sunday" that opens the following week. */
export function nextCycleWindows(anchor: Date): CycleWindows {
  return weeklyCycleFrom(new Date(anchor.getTime() + 7 * DAY_MS));
}

/** When the cycle anchored on `anchor` becomes archive material. */
export function archiveAtFor(anchor: Date): string {
  return new Date(anchor.getTime() + 7 * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Countdowns
// ---------------------------------------------------------------------------

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  /** True once the target instant has passed. */
  elapsed: boolean;
}

/** Splits the time between `now` and `target` into display parts. */
export function countdownParts(target: string | Date, now: Date = new Date()): CountdownParts {
  const targetMs = typeof target === "string" ? Date.parse(target) : target.getTime();
  const totalMs = Math.max(0, targetMs - now.getTime());

  return {
    days: Math.floor(totalMs / DAY_MS),
    hours: Math.floor((totalMs % DAY_MS) / HOUR_MS),
    minutes: Math.floor((totalMs % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((totalMs % MINUTE_MS) / 1000),
    totalMs,
    elapsed: targetMs <= now.getTime(),
  };
}

/** "3D 08H 42M" — the countdown headline. Drops leading zero units. */
export function formatCountdown(target: string | Date, now: Date = new Date()): string {
  const parts = countdownParts(target, now);
  if (parts.elapsed) return "0M";

  const segments: string[] = [];
  if (parts.days > 0) segments.push(`${parts.days}D`);
  if (parts.days > 0 || parts.hours > 0) segments.push(`${String(parts.hours).padStart(2, "0")}H`);
  segments.push(`${String(parts.minutes).padStart(2, "0")}M`);

  return segments.join(" ");
}

/** The timestamp a live viewer should be counting down to, if any. */
export function countdownTarget(
  status: CompetitionStatus,
  windows: CycleWindows,
): string | null {
  switch (status) {
    case "upcoming":
      return windows.start_at;
    case "live":
      return windows.submission_deadline;
    case "voting_closed":
      return windows.voting_deadline;
    default:
      return null;
  }
}

/** What that countdown means to the reader. */
export function countdownLabel(status: CompetitionStatus): string {
  switch (status) {
    case "upcoming":
      return "starts in";
    case "live":
      return "left to submit";
    case "voting_closed":
      return "left to vote";
    default:
      return "";
  }
}

/** A readable cycle date (weekday, day, month, time) in the app timezone. */
export function formatCycleDate(value: string, timeZone = competitionsTimeZone()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
