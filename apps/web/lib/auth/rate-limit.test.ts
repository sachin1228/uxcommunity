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

test("critical limits fail closed when Upstash is unavailable in production", async () => {
  await withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      NODE_ENV: "production",
    },
    async () => {
      const result = await rateLimit("critical:probe", 5, 60, { failClosed: true });
      assert.equal(result.success, false);
    },
  );
});

test("development still allows requests without local Upstash", async () => {
  await withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      NODE_ENV: "development",
    },
    async () => {
      const result = await rateLimit("dev:probe", 5, 60, { failClosed: true });
      assert.equal(result.success, true);
    },
  );
});

test("non-critical endpoints retain the documented availability fallback", async () => {
  await withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      NODE_ENV: "production",
    },
    async () => {
      const result = await rateLimit("read:probe", 5, 60);
      assert.equal(result.success, true);
    },
  );
});
