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
    dedupeFetch("/api/communities/c1/threads/t1/like", {
      method: "POST",
      body: JSON.stringify({ liked: true }),
    }),
    dedupeFetch("/api/communities/c1/threads/t1/like", {
      method: "POST",
      body: JSON.stringify({ liked: false }),
    }),
  ])

  assert.equal(calls, 2)
})

test("10 concurrent identical saves produce one fetch and every caller can read the body", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return jsonResponse({ saved: true, save_count: 3 })
  }) as typeof fetch

  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved: true }),
  }

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      dedupeFetch("/api/communities/c1/events/e1/save", init),
    ),
  )

  assert.equal(calls, 1)
  const bodies = await Promise.all(responses.map((r) => r.json()))
  assert.ok(bodies.every((b) => b.saved === true))
})

test("url-mode cooldown collapses alternating toggle bodies into one request", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({ saved: calls === 1 })
  }) as typeof fetch

  // A rapid like/save toggle fires alternating bodies — with url-mode they
  // must all resolve against the first network request.
  await dedupeFetch("/api/communities/c1/events/e1/save", {
    method: "POST",
    body: JSON.stringify({ saved: true }),
  }, { cooldownMode: "url" })
  const replayed = await dedupeFetch("/api/communities/c1/events/e1/save", {
    method: "POST",
    body: JSON.stringify({ saved: false }),
  }, { cooldownMode: "url" })

  assert.equal(calls, 1)
  const data = await replayed.json()
  assert.equal(data.saved, true, "replay returns the first request's result")
})

test("different resources never collide even in url mode", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({ ok: true })
  }) as typeof fetch

  await Promise.all([
    dedupeFetch("/api/communities/c1/events/e1/save", { method: "POST", body: JSON.stringify({ saved: true }) }, { cooldownMode: "url" }),
    dedupeFetch("/api/communities/c1/events/e2/save", { method: "POST", body: JSON.stringify({ saved: true }) }, { cooldownMode: "url" }),
  ])

  assert.equal(calls, 2)
})

test("url-mode does not collapse when the cooldown window has passed", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({ saved: calls % 2 === 1 })
  }) as typeof fetch

  await dedupeFetch("/api/communities/c1/events/e1/save", { method: "POST", body: JSON.stringify({ saved: true }) }, { cooldownMode: "url", mutationCooldownMs: 100 })
  await new Promise((resolve) => setTimeout(resolve, 150))
  await dedupeFetch("/api/communities/c1/events/e1/save", { method: "POST", body: JSON.stringify({ saved: false }) }, { cooldownMode: "url", mutationCooldownMs: 100 })

  assert.equal(calls, 2)
})

test("exact-mode keeps alternating toggle bodies as separate requests", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return jsonResponse({ saved: calls % 2 === 1 })
  }) as typeof fetch

  await Promise.all([
    dedupeFetch("/api/communities/c1/events/e1/save", { method: "POST", body: JSON.stringify({ saved: true }) }),
    dedupeFetch("/api/communities/c1/events/e1/save", { method: "POST", body: JSON.stringify({ saved: false }) }),
  ])

  assert.equal(calls, 2)
})

test("reconstructs bodyless 204 responses without a body (DELETE showcase bug)", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(null, { status: 204 })
  }) as typeof fetch

  // Fresh request path: status 204 forbids a body, so buffering "" and
  // rebuilding the Response with it must not throw.
  const response = await dedupeFetch("/api/communities/c1/showcase/p1", {
    method: "DELETE",
  })
  assert.equal(response.status, 204)
  assert.equal(await response.text(), "")

  // Settle-window replay path: the reconstructed Response must also be valid.
  const replayed = await dedupeFetch("/api/communities/c1/showcase/p1", {
    method: "DELETE",
  })
  assert.equal(replayed.status, 204)
  assert.equal(await replayed.text(), "")
  assert.equal(calls, 1)
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
