/**
 * Unit tests for the 5K realtime fan-out accounting helpers.
 *
 *   npm run test:k6-realtime
 *
 * These are the rules the load test's headline numbers depend on: delivered,
 * missing and duplicate counts must be exact per event, and latency must be
 * reported as "not measured" rather than as a fabricated zero when the protocol
 * did not give us a timestamp. No network, Worker or Cloudflare account needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DeliveryTracker,
  LATENCY_BUCKETS,
  MAX_TRACKED_EVENTS,
  assertStagingTarget,
  bucketize,
  makeEventId,
  parseEventId,
  parseEventMarker,
  percentile,
  summarizeSamples,
  userIdForIndex,
} from "./realtime-fanout.mjs";

// ── DeliveryTracker: exact per-event accounting ───────────────────────────

test("record counts a first delivery exactly once and flags repeats as duplicates", () => {
  const tracker = new DeliveryTracker({ eventCount: 3, capacity: 4 });

  assert.equal(tracker.record(0, 0, 10), "first");
  assert.equal(tracker.record(0, 0, 11), "duplicate");
  assert.equal(tracker.record(0, 2, 30), "first");

  assert.equal(tracker.receivedFor(0), 1);
  assert.equal(tracker.duplicatesFor(0), 1);
  assert.equal(tracker.duplicatesFor(1), 0);
  assert.equal(tracker.totalReceived, 2);
  assert.equal(tracker.totalDuplicates, 1);
});

test("missing is derived against the expected subscriber count, never clamped to a negative", () => {
  const tracker = new DeliveryTracker({ eventCount: 1, capacity: 3 });
  tracker.record(0, 0, 5);

  assert.equal(tracker.missingFor(0, 3), 2);
  assert.equal(tracker.missingFor(0, 1), 0);
});

test("receivers counts sockets that got at least one event, not deliveries", () => {
  const tracker = new DeliveryTracker({ eventCount: 4, capacity: 3 });
  tracker.record(0, 0, 1);
  tracker.record(0, 1, 1);
  tracker.record(2, 3, 1);

  assert.equal(tracker.receivers, 2);
});

test("out-of-range events and clients are ignored instead of counted", () => {
  const tracker = new DeliveryTracker({ eventCount: 2, capacity: 2 });

  assert.equal(tracker.record(0, 2, 1), null);
  assert.equal(tracker.record(0, -1, 1), null);
  assert.equal(tracker.record(2, 0, 1), null);
  assert.equal(tracker.record(0, 0, Number.NaN), "first"); // delivered, latency unknown
  assert.equal(tracker.totalReceived, 1);
  assert.equal(tracker.totalDuplicates, 0);
});

test("unmatched frames are counted separately from deliveries", () => {
  const tracker = new DeliveryTracker({ eventCount: 1, capacity: 1 });
  tracker.recordUnmatched();
  tracker.recordUnmatched();

  assert.equal(tracker.unmatchedFrames, 2);
  assert.equal(tracker.totalReceived, 0);
});

test("latency keeps one first-arrival sample per (event, socket) pair", () => {
  const tracker = new DeliveryTracker({ eventCount: 2, capacity: 2 });
  tracker.record(0, 0, 120);
  tracker.record(0, 0, 900); // duplicate must not add a second sample
  tracker.record(1, 0, 180);

  assert.deepEqual(tracker.latenciesFor(0), [120, 180]);
  assert.equal(tracker.fanoutSpanFor(0), 60);
  assert.equal(tracker.fanoutSpanFor(1), null);
});

test("allLatencies returns only measured samples", () => {
  const tracker = new DeliveryTracker({ eventCount: 2, capacity: 2 });
  tracker.record(0, 0, Number.NaN);
  tracker.record(1, 1, 42);

  assert.deepEqual(tracker.allLatencies(), [42]);
});

test("the tracker allocates a fixed bitmap regardless of how many frames arrive", () => {
  const tracker = new DeliveryTracker({ eventCount: 10, capacity: 5000 });

  for (let i = 0; i < 5000; i += 1) {
    for (let seq = 0; seq < 10; seq += 1) tracker.record(i, seq, 5);
  }

  assert.equal(tracker.totalReceived, 50_000);
  assert.equal(tracker.received.byteLength, 10 * 5000);
  assert.equal(tracker.receivers, 5000);
});

test("constructing with an unusable event count or capacity fails loudly", () => {
  assert.throws(() => new DeliveryTracker({ eventCount: 0, capacity: 1 }), /eventCount/);
  assert.throws(() => new DeliveryTracker({ eventCount: 1, capacity: 0 }), /capacity/);
  assert.throws(
    () => new DeliveryTracker({ eventCount: MAX_TRACKED_EVENTS + 1, capacity: 1 }),
    /MAX_TRACKED_EVENTS/,
  );
});

// ── Event identity ───────────────────────────────────────────────────────

test("event ids round-trip and other runs' events are rejected", () => {
  const testId = "h3-1758990000000";

  assert.equal(makeEventId(testId, 7), "h3-1758990000000#7");
  assert.equal(parseEventId(makeEventId(testId, 7), testId), 7);

  assert.equal(parseEventId("h3-other-run#7", testId), null);
  assert.equal(parseEventId("h3-1758990000000#abc", testId), null);
  assert.equal(parseEventId(undefined, testId), null);
  assert.equal(parseEventId("h3-1758990000000#-1", testId), null);
});

test("event markers are found inside app-authored message text", () => {
  const testId = "h3-1758990000000";

  assert.equal(parseEventMarker(`H-3 fanout load test event ${testId}#12`, testId), 12);
  assert.equal(parseEventMarker(`prefix ${testId}#0 suffix`, testId), 0);
  assert.equal(parseEventMarker("unrelated message", testId), null);
  assert.equal(parseEventMarker(`other-run#5`, testId), null);
  assert.equal(parseEventMarker(`${testId}#x`, testId), null);
  assert.equal(parseEventMarker(null, testId), null);
});

// ── Latency statistics ───────────────────────────────────────────────────

test("percentile is nearest-rank and tolerates unsorted input", () => {
  const values = [500, 100, 300, 200, 400];

  assert.equal(percentile(values, 50), 300);
  assert.equal(percentile(values, 95), 500);
  assert.equal(percentile([], 95), 0);
});

test("summarizeSamples reports null instead of a fabricated zero for no samples", () => {
  assert.equal(summarizeSamples([]), null);
  assert.equal(summarizeSamples([Number.NaN]), null);

  const summary = summarizeSamples([100, 200, 300, 400, 500]);
  assert.deepEqual(summary, {
    count: 5,
    min: 100,
    max: 500,
    mean: 300,
    p50: 300,
    p90: 500,
    p95: 500,
    p99: 500,
  });
});

test("bucketize places every sample in exactly one bucket", () => {
  const buckets = bucketize([10, 30, 60, 120, 300, 700, 1500, 3000, 9000]);

  assert.equal(buckets.length, LATENCY_BUCKETS.length);
  assert.deepEqual(
    buckets.map((bucket) => bucket.count),
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(
    buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    9,
  );
});

// ── Identity + target guards ─────────────────────────────────────────────

test("userIdForIndex produces distinct v4-shaped uuids", () => {
  const ids = new Set();
  for (let i = 0; i < 5200; i += 1) ids.add(userIdForIndex(i));

  assert.equal(ids.size, 5200);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  }

  // Deterministic: the ladder's stages authenticate the same identities.
  assert.equal(userIdForIndex(41), userIdForIndex(41));
  assert.throws(() => userIdForIndex(-1), /non-negative integer/);
});

test("assertStagingTarget refuses a production host unless explicitly overridden", () => {
  assert.equal(assertStagingTarget("wss://rt.uxcommunity.in").ok, false);
  assert.equal(
    assertStagingTarget("https://acme-staging.example.com").ok,
    true,
  );
  assert.equal(
    assertStagingTarget("wss://uxcommunity-realtime-staging.patilsachin1228.workers.dev").ok,
    true,
  );
  assert.equal(assertStagingTarget("ws://localhost:8787").ok, true);
  assert.equal(assertStagingTarget("wss://rt.uxcommunity.in", { allowNonStaging: true }).ok, true);
  assert.equal(assertStagingTarget("not-a-url").ok, false);
});
