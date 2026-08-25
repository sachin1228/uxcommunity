import assert from "node:assert/strict";
import test from "node:test";

import { moderationFailureResponse } from "./http";
import type { ModerationDecision } from "./types";

function blockedDecision(status: "review" | "rejected"): ModerationDecision {
  return {
    status,
    allowed: false,
    reason: "blocked",
    provider: "test",
    confidence: 1,
    triggered_rules: [],
    scores: {},
    duration_ms: 0,
  };
}

test("returns a non-success status for review decisions", async () => {
  const response = moderationFailureResponse(blockedDecision("review"));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "Content requires moderator review.");
});

test("returns a non-success status for rejected decisions", () => {
  assert.equal(moderationFailureResponse(blockedDecision("rejected")).status, 422);
});
