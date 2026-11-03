import test from "node:test";
import assert from "node:assert/strict";
import {
  checkGlobalRequestRateLimit,
  getGlobalRequestKey,
  getRateLimitHeaders,
  retryAfterSeconds,
} from "./global-request-rate-limit";

test("both global windows start before either external check completes", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const result = checkGlobalRequestRateLimit("parallel-test", { limit: async key => {
    calls.push(key);
    await pending;
    return { success: true, remaining: 4, resetAt: Date.now() + 1000 };
  } });
  assert.equal(calls.length, 2, "a sequential implementation starts only one window");
  release();
  assert.equal((await result).success, true);
});

test("either exhausted quota blocks a request, including a cached sustained allowance", async () => {
  for (const denied of ["burst", "sustained"]) {
    const result = await checkGlobalRequestRateLimit(`denied-${denied}`, { limit: async key => ({
      success: !key.includes(`:${denied}:`), remaining: 0, resetAt: Date.now() + 1000,
    }) });
    assert.equal(result.success, false);
  }
  const key = "cached-allowance-denied-burst";
  await checkGlobalRequestRateLimit(key, { limit: async () => ({ success: true, remaining: 2, resetAt: Date.now() + 1000 }) });
  const calls: string[] = [];
  const result = await checkGlobalRequestRateLimit(key, { limit: async name => {
    calls.push(name);
    return { success: false, remaining: 0, resetAt: Date.now() + 1000 };
  } });
  assert.equal(calls.length, 1);
  assert.equal(result.success, false);
});

test("uses the authenticated user as the global limiter identity", () => {
  const request = { headers: new Headers() };

  assert.equal(getGlobalRequestKey(request, "user-123"), "user:user-123");
});

test("prefers Cloudflare's connecting IP for public requests", () => {
  const request = {
    headers: new Headers({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20, 198.51.100.21",
    }),
  };

  assert.equal(getGlobalRequestKey(request), "ip:203.0.113.10");
});

test("uses the first forwarded IP when Cloudflare's header is absent", () => {
  const request = {
    headers: new Headers({
      "x-forwarded-for": "198.51.100.20, 198.51.100.21",
    }),
  };

  assert.equal(getGlobalRequestKey(request), "ip:198.51.100.20");
});

test("always returns a positive retry delay", () => {
  assert.equal(retryAfterSeconds(Date.now() - 1), "1");
});

test("sets standard rate-limit response headers", () => {
  const resetAt = Date.now() + 5000;
  const headers = getRateLimitHeaders({ remaining: 12, resetAt });

  assert.equal(headers["Retry-After"], retryAfterSeconds(resetAt));
  assert.equal(headers["X-RateLimit-Remaining"], "12");
  assert.equal(headers["Cache-Control"], "no-store");
});
