import test from "node:test";
import assert from "node:assert/strict";

import { isActiveUserRow } from "./liveness";

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
