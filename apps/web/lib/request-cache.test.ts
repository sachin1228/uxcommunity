import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  canonicalRequestKey,
  clearRequestCache,
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  invalidateRequest,
  patchCachedRequest,
} from "./request-cache"

const originalFetch = globalThis.fetch

afterEach(() => {
  clearRequestCache()
  globalThis.fetch = originalFetch
})

test("canonicalizes query parameters and isolates users", () => {
  assert.equal(
    canonicalRequestKey("/api/feed?b=2&a=1", "user-a"),
    "user-a:/api/feed?a=1&b=2",
  )
  assert.notEqual(
    canonicalRequestKey("/api/feed", "user-a"),
    canonicalRequestKey("/api/feed", "user-b"),
  )
})

test("deduplicates concurrent GET requests", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return new Response(JSON.stringify({ value: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  const [first, second] = await Promise.all([
    fetchJsonCached<{ value: number }>("/api/feed", {}, "user-a"),
    fetchJsonCached<{ value: number }>("/api/feed", {}, "user-a"),
  ])

  assert.equal(calls, 1)
  assert.deepEqual(first, second)
})

test("reuses fresh data and force-revalidates stale data", async () => {
  let calls = 0
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ value: ++calls }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )) as typeof fetch

  assert.equal((await fetchJsonCached<{ value: number }>("/api/feed", {}, "user-a")).value, 1)
  assert.equal((await fetchJsonCached<{ value: number }>("/api/feed", {}, "user-a")).value, 1)
  assert.equal((await fetchJsonCached<{ value: number }>("/api/feed", { force: true }, "user-a")).value, 2)
})

test("patches and invalidates only the requested user key", async () => {
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ count: 1 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )) as typeof fetch

  initRequestCache("user-a")
  await fetchJsonCached<{ count: number }>("/api/feed", {}, "user-a")
  patchCachedRequest<{ count: number }>("/api/feed", (value) => ({ count: value.count + 1 }), "user-a")
  assert.equal(getCachedRequest<{ count: number }>("/api/feed", "user-a")?.count, 2)

  invalidateRequest("/api/feed", "user-a")
  assert.equal(getCachedRequest("/api/feed", "user-a"), undefined)
})
