import assert from "node:assert/strict";
import test from "node:test";
import { rateLimit } from "./rate-limit";

const envKeys = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "NODE_ENV"] as const;

function withEnv(values: Partial<Record<(typeof envKeys)[number], string | undefined>>, fn: () => Promise<void>) {
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

test("production fails open when Upstash is not configured", async () => {
  await withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      NODE_ENV: "production",
    },
    async () => {
      const result = await rateLimit("production:missing-config", 5, 60);
      assert.equal(result.success, true);
    },
  );
});

test("development also allows requests without local Upstash", async () => {
  await withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      NODE_ENV: "development",
    },
    async () => {
      const result = await rateLimit("development:missing-config", 5, 60);
      assert.equal(result.success, true);
    },
  );
});

test("Redis connection errors fail open instead of blocking the request", async () => {
  await withEnv(
    {
      UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
      UPSTASH_REDIS_REST_TOKEN: "test-token",
      NODE_ENV: "production",
    },
    async () => {
      const result = await rateLimit("production:connection-error", 7, 61);
      assert.equal(result.success, true);
    },
  );
});
