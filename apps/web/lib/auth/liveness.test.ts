import test from "node:test";
import assert from "node:assert/strict";

import { isActiveUserRow, isSuspended } from "./liveness";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");

test("a missing account row is inactive", () => {
  assert.equal(isActiveUserRow(null), false);
  assert.equal(isActiveUserRow(undefined), false);
});

test("a blocked account is inactive", () => {
  assert.equal(isActiveUserRow({ is_blocked: true }), false);
});

test("an existing, unblocked account is active", () => {
  assert.equal(isActiveUserRow({ is_blocked: false }), true);
});

test("a live temporary suspension is inactive", () => {
  assert.equal(
    isActiveUserRow(
      { is_blocked: false, suspended_until: "2026-11-05T12:00:00.000Z" },
      NOW,
    ),
    false,
  );
  assert.equal(
    isSuspended("2026-11-05T12:00:00.000Z", NOW),
    true,
  );
});

test("an expired suspension returns the account to active", () => {
  assert.equal(
    isActiveUserRow(
      { is_blocked: false, suspended_until: "2026-10-29T12:00:00.000Z" },
      NOW,
    ),
    true,
  );
  assert.equal(isSuspended("2026-10-29T12:00:00.000Z", NOW), false);
});

test("malformed suspension timestamps fail open rather than locking every account", () => {
  assert.equal(isSuspended("not-a-date", NOW), false);
  assert.equal(isSuspended(null, NOW), false);
  assert.equal(isSuspended(undefined, NOW), false);
});
