import test from "node:test";
import assert from "node:assert/strict";

import {
  APPEAL_DAILY_LIMIT,
  APPEAL_MESSAGE_MAX_LENGTH,
  APPEAL_MESSAGE_MIN_LENGTH,
  appealBlockedMessage,
  canAppealReport,
  validateAppeal,
} from "./appeals";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

test("the affected member can appeal a removal or account action", () => {
  for (const status of ["removed", "actioned"]) {
    assert.deepEqual(canAppealReport({ status, targetAuthorId: SUBJECT }, SUBJECT), {
      allowed: true,
    });
  }
});

test("a dismissed report has nothing to appeal", () => {
  assert.deepEqual(canAppealReport({ status: "dismissed", targetAuthorId: SUBJECT }, SUBJECT), {
    allowed: false,
    reason: "not_actioned",
  });
  assert.deepEqual(canAppealReport({ status: "pending", targetAuthorId: SUBJECT }, SUBJECT), {
    allowed: false,
    reason: "not_actioned",
  });
});

test("only the account the action was taken against can appeal", () => {
  assert.deepEqual(canAppealReport({ status: "removed", targetAuthorId: SUBJECT }, OTHER), {
    allowed: false,
    reason: "not_affected_user",
  });
  assert.deepEqual(canAppealReport({ status: "removed", targetAuthorId: null }, SUBJECT), {
    allowed: false,
    reason: "not_affected_user",
  });
});

test("appeal text must be long enough and within the cap", () => {
  const base = { status: "removed", targetAuthorId: SUBJECT };
  assert.deepEqual(validateAppeal(base, SUBJECT, ""), {
    allowed: false,
    reason: "message_too_short",
  });
  assert.deepEqual(
    validateAppeal(base, SUBJECT, "a".repeat(APPEAL_MESSAGE_MIN_LENGTH - 1)),
    { allowed: false, reason: "message_too_short" },
  );
  assert.deepEqual(
    validateAppeal(base, SUBJECT, "a".repeat(APPEAL_MESSAGE_MIN_LENGTH)),
    { allowed: true },
  );
  assert.deepEqual(
    validateAppeal(base, SUBJECT, "a".repeat(APPEAL_MESSAGE_MAX_LENGTH + 1)),
    { allowed: false, reason: "message_too_long" },
  );
  // Surrounding whitespace never counts toward the minimum.
  assert.deepEqual(
    validateAppeal(base, SUBJECT, `   ${"a".repeat(APPEAL_MESSAGE_MIN_LENGTH)}   `),
    { allowed: true },
  );
});

test("failed validation never bypasses ownership", () => {
  assert.deepEqual(
    validateAppeal({ status: "removed", targetAuthorId: SUBJECT }, OTHER, "a".repeat(100)),
    { allowed: false, reason: "not_affected_user" },
  );
});

test("blocked copy is specific and does not leak another member's state", () => {
  assert.match(appealBlockedMessage("not_affected_user"), /Only the account/);
  assert.match(appealBlockedMessage("not_actioned"), /did not end in a moderation action/);
  assert.match(appealBlockedMessage("message_too_short"), new RegExp(String(APPEAL_MESSAGE_MIN_LENGTH)));
  assert.match(appealBlockedMessage("message_too_long"), new RegExp(String(APPEAL_MESSAGE_MAX_LENGTH)));
  assert.equal(APPEAL_DAILY_LIMIT, 3);
});
