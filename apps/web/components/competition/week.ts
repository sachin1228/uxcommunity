/**
 * The weekly competition's clock.
 *
 * One competition per week; a week is the IST (UTC+05:30) Monday–Sunday
 * containing "now". Every boundary is computed as an absolute UTC instant —
 * IST is a fixed offset with no DST — so the phase and the countdown are the
 * same in every browser timezone: the viewer's clock only decides *when* the
 * model is computed, never what it shows.
 *
 *   Mon 00:00 → 09:00      gap          the week's brief drops at 09:00
 *   Mon 09:00 → Fri 00:00  submissions  entries close Thu 23:59
 *   Fri 00:00 → Sun 00:00  voting       voting closes Sat 23:59
 *   Sun 00:00 → 10:00      crowning     entries locked, winner crowned at 10:00
 *   Sun 10:00 → Mon 00:00  winner
 *
 * Pure functions only — no React, no browser APIs — so the phase boundaries
 * can be exercised directly from a script.
 */

export type Phase = "gap" | "submissions" | "voting" | "crowning" | "winner";

export type RailState = "done" | "current" | "upcoming";

export interface RailNode {
  key: "brief" | "submit" | "vote" | "winner";
  /** Day label on the Mon–Sun strip. */
  day: string;
  /** What happens on that day. */
  label: string;
  state: RailState;
  /** Day-column centre, as a fraction of the strip's width. */
  center: number;
}

export interface WeekModel {
  phase: Phase;
  /** Status chip in the hero's first row. */
  chip: string;
  /** True while an open window is running (chip carries an ink dot). */
  chipLive: boolean;
  weekNumber: number;
  /** "Oct 5 – Oct 11", IST dates, mono. */
  rangeLabel: string;
  /** The instant the countdown counts down to. */
  deadlineMs: number;
  /** Absolute deadline, as copy under the countdown. */
  deadlineLabel: string;
  /** "2d 14h" — the countdown itself, minute granularity. */
  countdown: string;
  entriesOpen: boolean;
  /** Where the entry window stands, for the modal's live deadline line. */
  entryDeadlineMs: number;
  entryDeadlineLabel: string;
  /** 0–1 position of "today" along the Mon–Sun strip. */
  todayProgress: number;
  /** 0 = Monday … 6 = Sunday, in IST. */
  todayIndex: number;
  rail: RailNode[];
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** IST wall-clock fields of an absolute instant (read with the UTC getters). */
function istFields(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(), // 0 = Sunday … 6 = Saturday
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** The absolute instant of an IST wall-clock time. */
function istTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MS;
}

/** ISO 8601 week number of the instant's IST date. */
function isoWeekNumber(ms: number): number {
  const f = istFields(ms);
  // The Thursday of the same ISO week decides both the year and the number.
  const thursday = new Date(
    Date.UTC(f.year, f.month, f.day + (3 - ((f.weekday + 6) % 7))),
  );
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(
    ((thursday.getTime() - yearStart) / DAY_MS + 1) / 7,
  );
}

/** "2d 14h" / "9h 14m" / "12m" — minutes round up so the number only reads
 *  0m at the boundary itself. */
export function countdownLabel(deadlineMs: number, now: number): string {
  const totalMinutes = Math.ceil(Math.max(0, deadlineMs - now) / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

/**
 * The current instant, read through this module so the clock stays a
 * data-layer concern — the same shape `formatRelativeTime` uses in the
 * notifications view. Server components call it at request time to seed the
 * board's first render; the client re-syncs with its own clock after.
 */
export function requestInstant(): number {
  return Date.now();
}

const rangeDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const PHASE_COPY: Record<
  Phase,
  { chip: string; live: boolean; deadlineLabel: string }
> = {
  gap: {
    chip: "Brief drops Mon 9:00",
    live: false,
    deadlineLabel: "Next brief drops Mon 9:00 IST",
  },
  submissions: {
    chip: "Submissions open",
    live: true,
    deadlineLabel: "Entries close Thu 23:59 IST",
  },
  voting: {
    chip: "Voting open",
    live: true,
    deadlineLabel: "Voting closes Sat 23:59 IST",
  },
  crowning: {
    chip: "Voting closed",
    live: false,
    deadlineLabel: "Winner crowned Sun 10:00 IST",
  },
  winner: {
    chip: "Winner day",
    live: true,
    deadlineLabel: "Next brief drops Mon 9:00 IST",
  },
};

/** done / current / upcoming per rail node (brief · submit · vote · winner). */
function railStates(phase: Phase): [RailState, RailState, RailState, RailState] {
  switch (phase) {
    case "gap":
      return ["current", "upcoming", "upcoming", "upcoming"];
    case "submissions":
      return ["done", "current", "upcoming", "upcoming"];
    case "voting":
      return ["done", "done", "current", "upcoming"];
    case "crowning":
    case "winner":
      return ["done", "done", "done", "current"];
  }
}

export function weekModel(now: number): WeekModel {
  const f = istFields(now);
  const todayIndex = (f.weekday + 6) % 7; // Monday = 0
  const mondayMs = istTime(f.year, f.month, f.day - todayIndex);

  const briefMs = mondayMs + 9 * HOUR_MS;
  const submitClosesMs = mondayMs + 4 * DAY_MS; // Fri 00:00 IST
  const voteClosesMs = mondayMs + 6 * DAY_MS; // Sun 00:00 IST
  const crownMs = voteClosesMs + 10 * HOUR_MS; // Sun 10:00 IST
  const nextBriefMs = mondayMs + 7 * DAY_MS + 9 * HOUR_MS;

  const phase: Phase =
    now < briefMs
      ? "gap"
      : now < submitClosesMs
        ? "submissions"
        : now < voteClosesMs
          ? "voting"
          : now < crownMs
            ? "crowning"
            : "winner";

  const copy = PHASE_COPY[phase];
  const deadlineMs =
    phase === "gap"
      ? briefMs
      : phase === "submissions"
        ? submitClosesMs
        : phase === "voting"
          ? voteClosesMs
          : phase === "crowning"
            ? crownMs
            : nextBriefMs;

  const entriesOpen = phase === "submissions";
  const entryDeadlineMs = entriesOpen
    ? submitClosesMs
    : phase === "gap"
      ? briefMs
      : nextBriefMs;

  const dayFraction = (f.hour * 60 + f.minute) / 1440;
  // Clamped so the marker's half-width never falls outside the strip.
  const todayProgress = Math.min(
    0.99,
    Math.max(0.01, (todayIndex + dayFraction) / 7),
  );

  const states = railStates(phase);

  return {
    phase,
    chip: copy.chip,
    chipLive: copy.live,
    weekNumber: isoWeekNumber(now),
    rangeLabel: `${rangeDay.format(new Date(mondayMs + IST_OFFSET_MS))} – ${rangeDay.format(
      new Date(mondayMs + 6 * DAY_MS + IST_OFFSET_MS),
    )}`,
    deadlineMs,
    deadlineLabel: copy.deadlineLabel,
    countdown: countdownLabel(deadlineMs, now),
    entriesOpen,
    entryDeadlineMs,
    entryDeadlineLabel: entriesOpen
      ? "Entries close Thu 23:59 IST"
      : "Submissions open Mon 9:00 IST",
    todayProgress,
    todayIndex,
    rail: [
      { key: "brief", day: "Mon", label: "Brief", center: 0.5 / 7, state: states[0] },
      { key: "submit", day: "Thu", label: "Submit closes", center: 3.5 / 7, state: states[1] },
      { key: "vote", day: "Fri–Sat", label: "Vote", center: 5 / 7, state: states[2] },
      { key: "winner", day: "Sun", label: "Winner", center: 6.5 / 7, state: states[3] },
    ],
  };
}
