import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OUTBOX_AUTH_PAUSE_MS,
  OUTBOX_BASE_DELAY_MS,
  classifyStatus,
  parseRetryAfterMs,
  retryDelayMs,
} from "./backoff";
import {
  claimRecord,
  createOutboxRecord,
  isClaimable,
  markManualRetry,
  scheduleRetry,
} from "./outbox";

function record(overrides = {}) {
  return {
    ...createOutboxRecord({
      id: "nonce-1",
      userId: "user-1",
      ref: { kind: "community", id: "c1" },
      body: {
        content: "hi",
        replyToId: null,
        replyToContent: null,
        mentionUserIds: [],
      },
      now: 1_000,
    }),
    ...overrides,
  };
}

test("new records are immediately claimable", () => {
  assert.equal(isClaimable(record(), 1_000), true);
});

test("a live lease cannot be double-sent; an expired one is reclaimed", () => {
  const claimed = claimRecord(record(), 1_000, 30_000);
  assert.equal(claimed.state, "sending");
  assert.equal(claimed.attempts, 1);
  assert.equal(isClaimable(claimed, 10_000), false);
  assert.equal(isClaimable(claimed, 31_000), true);
});

test("retryable failures back off exponentially and become claimable later", () => {
  const claimed = claimRecord(record(), 1_000, 30_000);
  const retried = scheduleRetry(
    claimed,
    { kind: "retry", error: "Network error." },
    2_000,
    { random: () => 0.5 },
  );
  assert.equal(retried.state, "queued");
  assert.equal(retried.attempts, 1);
  assert.equal(retried.nextAttemptAt, 2_000 + OUTBOX_BASE_DELAY_MS);
  assert.equal(isClaimable(retried, 2_001), false);
  assert.equal(isClaimable(retried, retried.nextAttemptAt), true);
});

test("backoff is capped and jitter stays within ±20%", () => {
  const low = retryDelayMs(3, () => 0);
  const high = retryDelayMs(3, () => 1);
  assert.equal(low, 6_400);
  assert.equal(high, 9_600);
  assert.equal(retryDelayMs(10, () => 1), 60_000, "never above the ceiling");
  assert.equal(retryDelayMs(10, () => 0), 48_000);
});

test("rate limits honour Retry-After; auth pauses instead of failing", () => {
  const claimed = claimRecord(record(), 1_000, 30_000);
  const limited = scheduleRetry(
    claimed,
    { kind: "rate-limit", error: "Too many", retryAfterMs: 12_000 },
    2_000,
    { random: () => 0.5 },
  );
  assert.equal(limited.nextAttemptAt, 14_000);

  const auth = scheduleRetry(
    claimed,
    { kind: "auth", error: "Session expired" },
    2_000,
    { random: () => 0.5 },
  );
  assert.equal(auth.state, "queued");
  assert.equal(auth.nextAttemptAt, 2_000 + OUTBOX_AUTH_PAUSE_MS);
});

test("permanent failures never retry; the row is retained as failed", () => {
  const claimed = claimRecord(record(), 1_000, 30_000);
  const failed = scheduleRetry(
    claimed,
    { kind: "permanent", error: "You can't send messages to this member." },
    2_000,
  );
  assert.equal(failed.state, "failed");
  assert.equal(failed.lastError, "You can't send messages to this member.");
  assert.equal(isClaimable(failed, 999_999), false);
  assert.equal(failed.body.content, "hi", "the payload is retained for a manual retry");
});

test("the attempt budget is bounded", () => {
  const claimed = claimRecord(record({ attempts: 6 }), 1_000, 30_000);
  const failed = scheduleRetry(claimed, { kind: "retry", error: "offline" }, 2_000, {
    maxAttempts: 6,
  });
  assert.equal(failed.state, "failed");
});

test("manual retry is due immediately and replenishes the budget", () => {
  const failed = scheduleRetry(
    claimRecord(record(), 1_000, 30_000),
    { kind: "permanent", error: "nope" },
    2_000,
  );
  const retried = markManualRetry(failed, 5_000);
  assert.equal(retried.state, "queued");
  assert.equal(retried.attempts, 0);
  assert.equal(retried.nextAttemptAt, 5_000);
  assert.equal(retried.lastError, null);
});

test("status classification", () => {
  assert.equal(classifyStatus(401), "auth");
  assert.equal(classifyStatus(429), "rate-limit");
  assert.equal(classifyStatus(408), "retry");
  assert.equal(classifyStatus(425), "retry");
  assert.equal(classifyStatus(503), "retry");
  assert.equal(classifyStatus(403), "permanent");
  assert.equal(classifyStatus(422), "permanent");
  assert.equal(classifyStatus(409), "permanent");
});

test("Retry-After parses seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("12"), 12_000);
  assert.equal(parseRetryAfterMs("1.5"), 1_500);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(
    parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000),
    6_000,
  );
});
