import assert from "node:assert/strict"
import test from "node:test"

import {
  CHAT_MESSAGE_RETENTION_DAYS,
  chatTimelineVisibleSince,
} from "./message-retention"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-10-25T12:00:00.000Z")

/** ISO timestamp `daysAgo` before the fixed clock. */
function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString()
}

test("the window is 15 days", () => {
  assert.equal(CHAT_MESSAGE_RETENTION_DAYS, 15)
})

test("a member who joined inside the window starts at their join point", () => {
  // Joined three days ago: old cards and old messages are both invisible, but
  // the join point is later than the cutoff, so it wins.
  assert.equal(
    chatTimelineVisibleSince({ joined_at: daysAgo(3) }, NOW),
    daysAgo(3),
  )
})

test("a long-standing member starts at the retention cutoff", () => {
  // Joined a year ago: the 15-day window is the later boundary, so the cards
  // age out with the messages instead of being permanent.
  assert.equal(
    chatTimelineVisibleSince({ joined_at: daysAgo(365) }, NOW),
    daysAgo(CHAT_MESSAGE_RETENTION_DAYS),
  )
})

test("clearing the history moves the start forward", () => {
  assert.equal(
    chatTimelineVisibleSince(
      { joined_at: daysAgo(365), history_cleared_at: daysAgo(2) },
      NOW,
    ),
    daysAgo(2),
  )

  // A cleared timestamp BEFORE the join point (a stale column) never wins.
  assert.equal(
    chatTimelineVisibleSince(
      { joined_at: daysAgo(3), history_cleared_at: daysAgo(90) },
      NOW,
    ),
    daysAgo(3),
  )
})

test("a missing or unparseable membership falls back to the cutoff", () => {
  const cutoff = daysAgo(CHAT_MESSAGE_RETENTION_DAYS)
  assert.equal(chatTimelineVisibleSince({}, NOW), cutoff)
  assert.equal(chatTimelineVisibleSince({ joined_at: null }, NOW), cutoff)
  assert.equal(chatTimelineVisibleSince({ joined_at: "not-a-date" }, NOW), cutoff)
})

test("PostgREST's +00:00 offsets compare as instants", () => {
  // The membership row arrives as "…+00:00", while the cutoff we compare it
  // with is "…Z"; comparing the strings would order them wrongly.
  const joined = "2026-10-23T12:00:00+00:00"
  assert.equal(chatTimelineVisibleSince({ joined_at: joined }, NOW), daysAgo(2))
})
