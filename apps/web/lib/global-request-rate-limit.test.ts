import test from "node:test";
import assert from "node:assert/strict";
import {
  getGlobalRequestKey,
  getRateLimitHeaders,
  retryAfterSeconds,
} from "./global-request-rate-limit";

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
