import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import { clearDedupeCache, dedupeFetch } from "./dedupe-fetch"

const originalFetch = globalThis.fetch

afterEach(() => {
  clearDedupeCache()
  globalThis.fetch = originalFetch
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

test("shares one in-flight POST across concurrent identical callers", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return jsonResponse({ ok: true })
  }) as typeof fetch

  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hello" }),
  }

  const results = await Promise.all([
    dedupeFetch("/api/communities/c1/messages", init),
    dedupeFetch("/api/communities/c1/messages", init),
    dedupeFetch("/api/communities/c1/messages", init),
  ])

  assert.equal(calls, 1)
  assert.ok(results.every((r) => r.ok))
})

test("ignores query parameter order when computing the key", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return jsonResponse({})
  }) as typeof fetch

  await Promise.all([
    dedupeFetch("/api/feed?b=2&a=1"),
    dedupeFetch("/api/feed?a=1&b=2"),
  ])

  assert.equal(calls, 1)
})

test("replays a successful request within the settle window, then fetches again", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({ value: calls })
  }) as typeof fetch

  const first = await dedupeFetch("/api/communities/c1/join", { method: "POST" })
  assert.equal(calls, 1)

  // Immediately after settle, an identical call must NOT hit the network.
  await dedupeFetch("/api/communities/c1/join", { method: "POST" })
  assert.equal(calls, 1)

  // Wait out the window — a fresh request is now allowed.
  await new Promise((resolve) => setTimeout(resolve, 800))
  await dedupeFetch("/api/communities/c1/join", { method: "POST" })
  assert.equal(calls, 2)
})

test("failure clears the lock so the user can retry immediately", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) return jsonResponse({ error: "boom" }, 500)
    return jsonResponse({ ok: true })
  }) as typeof fetch

  const first = await dedupeFetch("/api/communities/c1/join", { method: "POST" })
  assert.equal(first.status, 500)

  // No settle-window replay for failures — this must be a brand new request.
  const retry = await dedupeFetch("/api/communities/c1/join", { method: "POST" })
  assert.equal(retry.status, 200)
  assert.equal(calls, 2)
})

test("rejects clear the lock and let a retry start a fresh request", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) throw new Error("network down")
    return jsonResponse({ ok: true })
  }) as typeof fetch

  await assert.rejects(() => dedupeFetch("/api/communities/c1/leave", { method: "DELETE" }))
  const retry = await dedupeFetch("/api/communities/c1/leave", { method: "DELETE" })
  assert.equal(retry.ok, true)
  assert.equal(calls, 2)
})

test("does not dedupe requests with different bodies", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch

  await Promise.all([
    dedupeFetch("/api/communities/c1/threads/t1/vote", {
      method: "POST",
      body: JSON.stringify({ voted: true }),
    }),
    dedupeFetch("/api/communities/c1/threads/t1/vote", {
      method: "POST",
      body: JSON.stringify({ voted: false }),
    }),
  ])

  assert.equal(calls, 2)
})

test("bypasses dedup for FormData bodies so uploads never collide", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({ url: `/upload-${calls}` })
  }) as typeof fetch

  const makeForm = () => {
    const form = new FormData()
    form.set("file", new Blob([`data-${Math.random()}`]))
    return form
  }

  await Promise.all([
    dedupeFetch("/api/upload", { method: "POST", body: makeForm() }),
    dedupeFetch("/api/upload", { method: "POST", body: makeForm() }),
  ])

  assert.equal(calls, 2)
})
