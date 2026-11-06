import assert from "node:assert/strict";
import test from "node:test";
import { classifyRateLimitFailure, rateLimit } from "./rate-limit";

const envKeys = [
  "APP_ENV",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NODE_ENV",
] as const;

function withEnv(
  values: Partial<Record<(typeof envKeys)[number], string | undefined>>,
  fn: () => Promise<void>,
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(envKeys.map((key) => [key, env[key]]));
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return fn().finally(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });
}

test("production strict fails closed when Upstash is not configured", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      const result = await rateLimit("strict-missing-config", 5, 60);
      assert.equal(result.success, false);
      assert.equal(result.degraded, true);
      assert.equal(result.reason, "missing_config");
    },
  );
});

test("production availability allows when Upstash is not configured", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      const result = await rateLimit("availability-missing-config", 5, 60, {
        mode: "availability",
      });
      assert.equal(result.success, true);
      assert.equal(result.degraded, true);
      assert.equal(result.reason, "missing_config");
    },
  );
});

test("strict uses a bounded local fallback when Redis is unreachable", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
      UPSTASH_REDIS_REST_TOKEN: "test-token",
    },
    async () => {
      const key = "strict-connection-error";
      const results = [];
      for (let i = 0; i < 6; i += 1) {
        results.push(await rateLimit(key, 5, 61));
      }
      assert.equal(results[0].success, true);
      assert.equal(results[0].degraded, true);
      assert.equal(results[5].success, false);
      assert.equal(results[5].remaining, 0);
    },
  );
});

test("availability keeps serving when Redis is unreachable", async () => {
  await withEnv(
    {
      APP_ENV: "production",
      UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
      UPSTASH_REDIS_REST_TOKEN: "test-token",
    },
    async () => {
      const result = await rateLimit("availability-connection-error", 1, 62, {
        mode: "availability",
      });
      assert.equal(result.success, true);
      assert.equal(result.degraded, true);
    },
  );
});

test("development without Upstash enforces a real local window", async () => {
  await withEnv(
    {
      APP_ENV: "development",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    async () => {
      const key = "development-local-window";
      const results = [];
      for (let i = 0; i < 4; i += 1) {
        results.push(await rateLimit(key, 3, 63));
      }
      assert.equal(results[2].success, true);
      assert.equal(results[3].success, false);
      assert.equal(results[3].degraded, undefined);
    },
  );
});

test("classifies redis failures without relying on a message prefix", () => {
  assert.equal(classifyRateLimitFailure(new Error("request timed out")), "timeout");
  assert.equal(classifyRateLimitFailure({ status: 503, message: "unavailable" }), "server_error");
  assert.equal(classifyRateLimitFailure({ status: 429, message: "rate limited" }), "quota");
  assert.equal(classifyRateLimitFailure(new Error("max requests limit exceeded")), "quota");
  assert.equal(classifyRateLimitFailure(new Error("socket hang up")), "unknown");
});
