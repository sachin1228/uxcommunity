import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  DEDUPE_BYPASS_HEADER,
  installGlobalFetchGuard,
  isSameOriginAppApi,
  shouldBypassGuard,
} from "./global-fetch"
import { clearDedupeCache } from "./dedupe-fetch"

const originalFetch = globalThis.fetch

const windowLike = {
  location: { origin: "http://localhost:3000" },
} as unknown as Window & typeof globalThis
;(globalThis as unknown as { window: unknown }).window = windowLike

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

let cleanup: (() => void) | null = null

afterEach(() => {
  clearDedupeCache()
  cleanup?.()
  cleanup = null
  globalThis.fetch = originalFetch
})

/**
 * Stub `window.fetch` and the global fetch, install the guard, then point the
 * global fetch at the guarded wrapper (in a browser window === globalThis, so
 * the guarded wrapper is what plain `fetch(...)` calls resolve to).
 */
function installWith(fetchStub: typeof fetch) {
  windowLike.fetch = fetchStub
  cleanup = installGlobalFetchGuard()
  globalThis.fetch = windowLike.fetch
}

test("coalesces concurrent identical GETs into one network request", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return jsonResponse({ ok: true })
  }) as typeof fetch)

  const results = await Promise.all([
    fetch("/api/communities"),
    fetch("/api/communities"),
    fetch("/api/communities"),
  ])

  assert.equal(calls, 1)
  assert.ok(results.every((r) => r.ok))
})

test("collapses a rapid burst of identical POSTs into one request", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({ ok: true })
  }) as typeof fetch)

  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "like" }),
  }
  await fetch("/api/communities/c1/showcase/p1", init)
  await fetch("/api/communities/c1/showcase/p1", init)
  await fetch("/api/communities/c1/showcase/p1", init)

  assert.equal(calls, 1)
})

test("toggle endpoints collapse alternating bodies within the cooldown", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({ saved: calls === 1 })
  }) as typeof fetch)

  await fetch("/api/communities/c1/resources/r1/save", {
    method: "POST",
    body: JSON.stringify({ saved: true }),
  })
  await fetch("/api/communities/c1/resources/r1/save", {
    method: "POST",
    body: JSON.stringify({ saved: false }),
  })

  assert.equal(calls, 1)
})

test("different mutation bodies stay separate", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch)

  await Promise.all([
    fetch("/api/communities/c1/messages", {
      method: "POST",
      body: JSON.stringify({ content: "a" }),
    }),
    fetch("/api/communities/c1/messages", {
      method: "POST",
      body: JSON.stringify({ content: "b" }),
    }),
  ])

  assert.equal(calls, 2)
})

test("non-API same-origin requests pass through untouched", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch)

  await fetch("/dashboard/communities")
  await fetch("/dashboard/communities")

  assert.equal(calls, 2)
})

test("cross-origin requests pass through untouched", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch)

  await fetch("https://external.example.com/data")

  assert.equal(calls, 1)
})

test("cache:no-store bypasses the guard", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch)

  await fetch("/api/communities", { cache: "no-store" })
  await fetch("/api/communities", { cache: "no-store" })

  assert.equal(calls, 2)
})

test("the dedupe-bypass header opts a request out", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch)

  await fetch("/api/communities", { headers: { [DEDUPE_BYPASS_HEADER]: "1" } })
  await fetch("/api/communities", { headers: { [DEDUPE_BYPASS_HEADER]: "1" } })

  assert.equal(calls, 2)
})

test("uploads with FormData bodies are never deduped", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({ url: `/upload-${calls}` })
  }) as typeof fetch)

  const makeForm = () => {
    const form = new FormData()
    form.set("file", new Blob([`data-${Math.random()}`]))
    return form
  }

  await Promise.all([
    fetch("/api/communities/c1/showcase/upload", { method: "POST", body: makeForm() }),
    fetch("/api/communities/c1/showcase/upload", { method: "POST", body: makeForm() }),
  ])

  assert.equal(calls, 2)
})

test("patching never recurses through dedupeFetch", async () => {
  let calls = 0
  installWith((async () => {
    calls += 1
    return jsonResponse({})
  }) as typeof fetch)

  await fetch("/api/home/feed")

  assert.equal(calls, 1)
})

test("predicates", () => {
  assert.equal(isSameOriginAppApi("/api/communities"), true)
  assert.equal(isSameOriginAppApi("/api/notifications?limit=5"), true)
  assert.equal(isSameOriginAppApi("/dashboard/communities"), false)
  assert.equal(isSameOriginAppApi("https://evil.example.com/api/communities"), false)

  assert.equal(shouldBypassGuard(undefined), false)
  assert.equal(shouldBypassGuard({ cache: "no-store" }), true)
  assert.equal(
    shouldBypassGuard({ headers: { [DEDUPE_BYPASS_HEADER]: "1" } }),
    true,
  )
  const form = new FormData()
  assert.equal(shouldBypassGuard({ method: "POST", body: form }), true)
})