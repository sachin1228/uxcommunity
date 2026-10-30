import test from "node:test";
import assert from "node:assert/strict";

import { blockedPeerIds } from "./peer-blocks";

const ME = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const C = "44444444-4444-4444-8444-444444444444";

test("a block counts in both directions", () => {
  assert.deepEqual(
    [...blockedPeerIds([
      { blocker_id: ME, blocked_id: A }, // I blocked A
      { blocker_id: B, blocked_id: ME }, // B blocked me
    ], ME)],
    [A, B],
  );
});

test("rows that do not involve the member are ignored", () => {
  assert.deepEqual(
    [...blockedPeerIds([
      { blocker_id: A, blocked_id: B },
      { blocker_id: ME, blocked_id: C },
    ], ME)],
    [C],
  );
});

test("duplicate rows and self-blocks collapse", () => {
  assert.deepEqual(
    [...blockedPeerIds([
      { blocker_id: ME, blocked_id: A },
      { blocker_id: A, blocked_id: ME }, // same pair, other direction
      { blocker_id: ME, blocked_id: A },
      { blocker_id: ME, blocked_id: ME },
    ], ME)],
    [A],
  );
});

test("no rows means no blocked peers", () => {
  assert.deepEqual([...blockedPeerIds([], ME)], []);
});
