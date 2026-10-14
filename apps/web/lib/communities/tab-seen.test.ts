import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceTabSeen,
  isNewerThan,
  newestIso,
  readTabSeen,
  tabSeenStorageKey,
} from "./tab-seen";

test("watermarks advance per tab and never move backwards", () => {
  const user = "tab-seen-test-user";
  const community = "tab-seen-test-community";
  assert.deepEqual(readTabSeen(user, community), {});

  assert.equal(advanceTabSeen(user, community, "threads", "2026-10-14T10:00:00.000Z"), true);
  assert.equal(readTabSeen(user, community).threads, "2026-10-14T10:00:00.000Z");
  assert.equal(readTabSeen(user, community).showcase, undefined);

  // A stale value (or a second tab offering an older timestamp) changes nothing.
  assert.equal(advanceTabSeen(user, community, "threads", "2026-10-14T09:00:00.000Z"), false);
  assert.equal(advanceTabSeen(user, community, "threads", "2026-10-14T10:00:00.000Z"), false);
  assert.equal(readTabSeen(user, community).threads, "2026-10-14T10:00:00.000Z");

  // Cross-format comparison: a +00:00 timestamp still orders correctly.
  assert.equal(advanceTabSeen(user, community, "threads", "2026-10-14T11:00:00+00:00"), true);
  assert.equal(readTabSeen(user, community).threads, "2026-10-14T11:00:00+00:00");
});

test("a baseline marker fills an unset tab but never replaces a timestamp", () => {
  const user = "tab-seen-test-baseline";
  const community = "c1";

  assert.equal(advanceTabSeen(user, community, "events", ""), true);
  assert.equal(readTabSeen(user, community).events, "");
  assert.equal(advanceTabSeen(user, community, "events", ""), false);

  // The first real item anchors the tab.
  assert.equal(advanceTabSeen(user, community, "events", "2026-10-14T10:00:00.000Z"), true);
  // Once anchored, a baseline can never come back and clear the tab.
  assert.equal(advanceTabSeen(user, community, "events", ""), false);
  assert.equal(readTabSeen(user, community).events, "2026-10-14T10:00:00.000Z");
});

test("watermarks are namespaced per user and per community", () => {
  assert.equal(tabSeenStorageKey("u1", "c1"), "uxcommunity:community-tabs:seen:v2:u1:c1");

  const u1 = "tab-seen-test-ns-u1";
  const u2 = "tab-seen-test-ns-u2";
  advanceTabSeen(u1, "c1", "threads", "2026-10-14T10:00:00.000Z");
  assert.deepEqual(readTabSeen(u2, "c1"), {});
  assert.deepEqual(readTabSeen(u1, "c2"), {});
});

test("isNewerThan compares parsed times, not string width", () => {
  // Postgres trims trailing zeros in fractional seconds — a string comparison
  // would order "…00.5" and "…00.51" wrongly.
  assert.equal(isNewerThan("2026-10-14T10:00:00.5+00:00", "2026-10-14T10:00:00.45+00:00"), true);
  assert.equal(isNewerThan("2026-10-14T10:00:00.000Z", "2026-10-14T10:00:00.000Z"), false);
  assert.equal(isNewerThan("2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z"), false);

  // Never tracked ⇒ no dot; a baseline marker ⇒ anything existing is new.
  assert.equal(isNewerThan("2026-10-14T10:00:00.000Z", undefined), false);
  assert.equal(isNewerThan("2026-10-14T10:00:00.000Z", ""), true);
  assert.equal(isNewerThan(null, ""), false);
});

test("newestIso picks by parsed time and tolerates nulls", () => {
  assert.equal(newestIso(null, null), null);
  assert.equal(newestIso("2026-10-14T10:00:00.000Z", null), "2026-10-14T10:00:00.000Z");
  assert.equal(newestIso(null, "2026-10-14T10:00:00.000Z"), "2026-10-14T10:00:00.000Z");
  assert.equal(
    newestIso("2026-10-14T10:00:00.000Z", "2026-10-14T10:00:00.5+00:00"),
    "2026-10-14T10:00:00.5+00:00",
  );
  assert.equal(
    newestIso("2026-10-14T10:00:00.5+00:00", "2026-10-14T10:00:00.000Z"),
    "2026-10-14T10:00:00.5+00:00",
  );
});
