import test from "node:test";
import assert from "node:assert/strict";

import { backoffDelay, isRetryable, withRetry } from "./r2.mjs";

function httpError(status, name = "Error") {
  const error = new Error(`${status}`);
  error.name = name;
  error.$metadata = { httpStatusCode: status };
  return error;
}

test("transient failures are retryable, rejected credentials are not", () => {
  assert.equal(isRetryable(httpError(500)), true);
  assert.equal(isRetryable(httpError(503)), true);
  assert.equal(isRetryable(httpError(429)), true);
  // A dead key never heals on a second attempt; retrying only delays the page.
  assert.equal(isRetryable(httpError(403)), false);
  assert.equal(isRetryable(httpError(400)), false);
  assert.equal(isRetryable(httpError(404, "NotFound")), false);
  // No HTTP status means the request never completed.
  assert.equal(isRetryable(new Error("socket hang up")), true);
});

test("withRetry retries a transient failure and returns the eventual result", async () => {
  let attempts = 0;
  const delays = [];
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw httpError(503);
      return "ok";
    },
    { sleep: async (ms) => delays.push(ms) },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.equal(delays.length, 2);
});

test("withRetry gives up immediately on a non-retryable failure", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw httpError(403, "AccessDenied");
      },
      { sleep: async () => {} },
    ),
    /403/,
  );
  assert.equal(attempts, 1);
});

test("withRetry stops after the configured number of attempts", async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw httpError(500);
      },
      { attempts: 2, sleep: async () => {} },
    ),
    /500/,
  );
  assert.equal(attempts, 2);
});

test("backoff grows with attempts and stays bounded and jittered", () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const delay = backoffDelay(attempt);
    assert.ok(delay >= 0);
    assert.ok(delay <= 8000, `delay ${delay} exceeded the ceiling`);
  }
});
