import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canComment,
  canRankByVotes,
  canSubmitEntry,
  canVote,
  countdownParts,
  cycleAnchorFor,
  deriveCompetitionStatus,
  formatCountdown,
  hasPublishedResults,
  nextCycleWindows,
  resolveEntrySort,
  statusLabel,
  WEEK_CYCLE_OFFSETS,
  weeklyCycleFrom,
  zonedTimeToUtc,
  type CycleWindows,
} from "./cycle";

/** One full weekly cycle: Sun 00:00 → Fri 18:00 → Sat 00:00. */
const WINDOWS: CycleWindows = {
  start_at: "2026-09-13T00:00:00.000Z",
  submission_deadline: "2026-09-18T18:00:00.000Z",
  voting_deadline: "2026-09-19T00:00:00.000Z",
  results_at: "2026-09-19T00:00:00.000Z",
};

function statusAt(iso: string, archivedAt: string | null = null) {
  return deriveCompetitionStatus(WINDOWS, new Date(iso), archivedAt);
}

test("status walks the week: upcoming → live → voting_closed → results", () => {
  assert.equal(statusAt("2026-09-12T23:59:59.999Z"), "upcoming");
  assert.equal(statusAt("2026-09-13T00:00:00.000Z"), "live");
  // A designer mid-week is still live.
  assert.equal(statusAt("2026-09-16T09:30:00.000Z"), "live");
  // Final submissions are in; voting is still open.
  assert.equal(statusAt("2026-09-18T18:00:00.000Z"), "voting_closed");
  assert.equal(statusAt("2026-09-18T23:59:59.999Z"), "voting_closed");
  // Saturday is results day.
  assert.equal(statusAt("2026-09-19T00:00:00.000Z"), "results");
  assert.equal(statusAt("2026-09-25T12:00:00.000Z"), "results");
});

test("archiving is a timestamp: the cycle becomes history when it passes", () => {
  const archiveAt = "2026-09-20T00:00:00.000Z";
  assert.equal(statusAt("2026-09-19T12:00:00.000Z", archiveAt), "results");
  assert.equal(statusAt("2026-09-20T00:00:00.000Z", archiveAt), "archived");
  assert.equal(statusAt("2026-10-01T00:00:00.000Z", archiveAt), "archived");
});

test("deadlines gate each action, and voting closes with the cycle", () => {
  // Submissions open only while live.
  assert.equal(canSubmitEntry("live"), true);
  assert.equal(canSubmitEntry("voting_closed"), false);
  assert.equal(canSubmitEntry("upcoming"), false);
  assert.equal(canSubmitEntry("results"), false);

  // Voting spans the whole week and stops at results.
  assert.equal(canVote("live"), true);
  assert.equal(canVote("voting_closed"), true);
  assert.equal(canVote("results"), false);
  assert.equal(canVote("upcoming"), false);

  // Discussion stays open through results day, and closes in the archive.
  assert.equal(canComment("live"), true);
  assert.equal(canComment("voting_closed"), true);
  assert.equal(canComment("results"), true);
  assert.equal(canComment("archived"), false);
  assert.equal(canComment("upcoming"), false);

  assert.equal(hasPublishedResults("results"), true);
  assert.equal(hasPublishedResults("archived"), true);
  assert.equal(hasPublishedResults("voting_closed"), false);
});

test("a live gallery is never sorted by votes", () => {
  // While voting is open, vote ordering is refused even when requested.
  assert.equal(resolveEntrySort("votes", "live"), "recent");
  assert.equal(resolveEntrySort("votes", "voting_closed"), "recent");
  // Once voting closes, ranking is meaningful.
  assert.equal(resolveEntrySort("votes", "results"), "votes");
  assert.equal(resolveEntrySort("votes", "archived"), "votes");

  assert.equal(canRankByVotes("live"), false);
  assert.equal(canRankByVotes("results"), true);

  // And a nonsense sort falls back rather than erroring.
  assert.equal(resolveEntrySort("nonsense", "live"), "recent");
  assert.equal(resolveEntrySort(null, "results"), "recent");
  // Chronological sorts are always allowed.
  assert.equal(resolveEntrySort("oldest", "live"), "oldest");
  assert.equal(resolveEntrySort("featured", "live"), "featured");
});

test("every status has a label for the chip", () => {
  for (const status of ["upcoming", "live", "voting_closed", "results", "archived"] as const) {
    assert.equal(typeof statusLabel(status), "string");
    assert.ok(statusLabel(status).length > 0);
  }
});

test("the weekly template is Sunday 00:00 → Friday 18:00 → Saturday 00:00", () => {
  const anchor = new Date("2026-09-13T00:00:00.000Z"); // a Sunday
  const cycle = weeklyCycleFrom(anchor);

  assert.equal(cycle.start_at, "2026-09-13T00:00:00.000Z");
  assert.equal(cycle.submission_deadline, "2026-09-18T18:00:00.000Z");
  assert.equal(cycle.voting_deadline, "2026-09-19T00:00:00.000Z");
  assert.equal(cycle.results_at, "2026-09-19T00:00:00.000Z");

  assert.equal(WEEK_CYCLE_OFFSETS.submissionDeadlineMs, 5 * 24 * 3_600_000 + 18 * 3_600_000);
  assert.ok(cycle.start_at < cycle.submission_deadline);
  assert.ok(cycle.submission_deadline < cycle.voting_deadline);
  assert.ok(cycle.voting_deadline <= cycle.results_at);
});

test("the next cycle starts exactly one week later — which archives the previous one", () => {
  const anchor = new Date("2026-09-13T00:00:00.000Z");
  const next = nextCycleWindows(anchor);

  assert.equal(next.start_at, "2026-09-20T00:00:00.000Z");
  // The previous cycle's results run right up to the next start.
  const previous = weeklyCycleFrom(anchor);
  assert.equal(Date.parse(previous.voting_deadline) < Date.parse(next.start_at), true);
});

test("the cycle anchor is the local Sunday midnight in the configured timezone", () => {
  // 2026-09-16T20:00Z is Thursday. In UTC the anchor is Sunday 00:00 UTC.
  assert.equal(
    cycleAnchorFor(new Date("2026-09-16T20:00:00.000Z"), "UTC").toISOString(),
    "2026-09-13T00:00:00.000Z",
  );

  // In Asia/Kolkata (UTC+05:30) 2026-09-16T20:00Z is already Thursday 01:30
  // local, so the anchor is still the same local Sunday — 00:00 IST is
  // 18:30 UTC on the previous day.
  assert.equal(
    cycleAnchorFor(new Date("2026-09-16T20:00:00.000Z"), "Asia/Kolkata").toISOString(),
    "2026-09-12T18:30:00.000Z",
  );

  // Just after local midnight on Sunday the anchor is that same Sunday.
  assert.equal(
    cycleAnchorFor(new Date("2026-09-13T18:30:00.000Z"), "Asia/Kolkata").toISOString(),
    "2026-09-12T18:30:00.000Z",
  );

  // Late Sunday local (23:59 IST) still belongs to that Sunday's cycle.
  assert.equal(
    cycleAnchorFor(new Date("2026-09-13T18:29:59.000Z"), "Asia/Kolkata").toISOString(),
    "2026-09-12T18:30:00.000Z",
  );

  // …and one second before local Sunday midnight the previous week owns it.
  assert.equal(
    cycleAnchorFor(new Date("2026-09-12T18:29:59.000Z"), "Asia/Kolkata").toISOString(),
    "2026-09-05T18:30:00.000Z",
  );
});

test("an unknown timezone falls back to a UTC week instead of throwing", () => {
  assert.equal(
    cycleAnchorFor(new Date("2026-09-16T20:00:00.000Z"), "Not/AZone").toISOString(),
    "2026-09-13T00:00:00.000Z",
  );
});

test("zoned wall-clock times resolve to the right UTC instant", () => {
  assert.equal(
    zonedTimeToUtc(2026, 9, 13, 0, 0, "Asia/Kolkata").toISOString(),
    "2026-09-12T18:30:00.000Z",
  );
  assert.equal(
    zonedTimeToUtc(2026, 9, 13, 0, 0, "UTC").toISOString(),
    "2026-09-13T00:00:00.000Z",
  );
  // A zone that observes DST: 00:00 local in New York on a September Sunday.
  assert.equal(
    zonedTimeToUtc(2026, 9, 13, 0, 0, "America/New_York").toISOString(),
    "2026-09-13T04:00:00.000Z",
  );
});

test("the countdown reports the parts a designer reads", () => {
  const now = new Date("2026-09-15T12:00:00.000Z"); // Tuesday noon

  // Sunday noon → the Friday 18:00 deadline is 3d 06h away.
  assert.equal(formatCountdown("2026-09-18T18:00:00.000Z", now), "3D 06H 00M");

  // Sub-day countdowns drop the day segment.
  assert.equal(formatCountdown("2026-09-15T12:42:00.000Z", now), "42M");
  assert.equal(formatCountdown("2026-09-15T15:08:00.000Z", now), "03H 08M");

  const parts = countdownParts("2026-09-18T18:00:00.000Z", now);
  assert.deepEqual(
    { days: parts.days, hours: parts.hours, minutes: parts.minutes, elapsed: parts.elapsed },
    { days: 3, hours: 6, minutes: 0, elapsed: false },
  );
});

test("a passed deadline never counts down into negative time", () => {
  const now = new Date("2026-09-19T00:00:01.000Z");
  assert.equal(formatCountdown("2026-09-19T00:00:00.000Z", now), "0M");

  const parts = countdownParts("2026-09-19T00:00:00.000Z", now);
  assert.equal(parts.totalMs, 0);
  assert.equal(parts.elapsed, true);
});
