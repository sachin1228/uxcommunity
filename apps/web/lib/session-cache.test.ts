import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test, { afterEach } from "node:test"

import { resetClientSessionCaches } from "./session-cache"
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  setCachedRequest,
} from "./request-cache"
import { sidebarStore, initUserCache, msgCache } from "./communities/cache"
import {
  pendingContentChangeCount,
  publishContentChange,
} from "./communities/content-sync"
import { getReadState, initReadManager, scheduleMarkRead } from "./communities/read-manager"
import {
  dedupeFetch,
  getDedupeFetchTelemetry,
  resetDedupeFetchImpl,
  setDedupeFetchImpl,
} from "./dedupe-fetch"
import { loadCurrentUserSummary } from "./current-user"

const originalFetch = globalThis.fetch

afterEach(() => {
  resetClientSessionCaches()
  resetDedupeFetchImpl()
  globalThis.fetch = originalFetch
})

function stubFetch(handler: (input: RequestInfo | URL) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    handler(input)) as typeof fetch
  setDedupeFetchImpl(globalThis.fetch)
}

test("drops every cache that can hold the previous member's data", async () => {
  // Request cache — fetched `/api/*` payloads.
  setCachedRequest("/api/notifications", { unread_count: 7 }, "user-a")
  assert.ok(getCachedRequest("/api/notifications", "user-a"))

  // Community / sidebar / chat caches.
  initUserCache("user-a")
  sidebarStore.data = { communities: [], fetchedAt: Date.now() }
  msgCache.set("community-a", [])
  assert.ok(sidebarStore.data)

  // Read manager — debounced/retrying mark-read decisions.
  initReadManager("user-a")
  scheduleMarkRead("community-a", { unreadCount: 3 })
  assert.ok(getReadState("community-a"))

  // Content-change bus — mutations queued for unmounted card lists.
  publishContentChange({ kind: "thread", id: "thread-a", patch: { title: "Hi" } })
  assert.equal(pendingContentChangeCount(), 1)

  // Replay buffer — a settled request a new session must not reuse.
  stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  await dedupeFetch("/api/feed")
  assert.equal(getDedupeFetchTelemetry().new, 1)

  // Shared `/api/auth/me` identity memo — the previous member's name/avatar.
  stubFetch(() =>
    new Response(JSON.stringify({ user: { name: "Ada", avatar_url: null } }), { status: 200 }),
  )
  assert.equal((await loadCurrentUserSummary())?.name, "Ada")

  resetClientSessionCaches()

  assert.equal(getCachedRequest("/api/notifications", "user-a"), undefined)
  assert.equal(sidebarStore.data, null)
  assert.equal(msgCache.size, 0)
  assert.equal(getReadState("community-a"), undefined)
  assert.equal(pendingContentChangeCount(), 0)
  assert.deepEqual(getDedupeFetchTelemetry(), {
    new: 0,
    deduped: 0,
    replayed: 0,
    bypassed: 0,
  })

  // The identity is refetched for the new session instead of replayed.
  stubFetch(() =>
    new Response(JSON.stringify({ user: { name: "Grace", avatar_url: null } }), { status: 200 }),
  )
  assert.equal((await loadCurrentUserSummary())?.name, "Grace")
})

test("every session boundary leaves with a full document navigation", () => {
  // Next's client Router Cache is keyed by URL and never sees the session
  // cookie, so a `router.push` after login/logout/signup is served the payload
  // rendered for the previous session (see next.config.js → staleTimes).
  // Verified in the running app: a client-side navigation after the session
  // cookie changes rendered the other account's server payload with no network
  // request at all.
  const boundaries = [
    "components/ui/useLogout.ts",
    "app/login/page.tsx",
    "app/signup/page.tsx",
  ]

  // The suite is run from the repo root by the npm scripts and from this
  // workspace's own directory by CI, so find the app instead of assuming one.
  const appDir = [process.cwd(), join(process.cwd(), "apps", "web")].find((dir) =>
    existsSync(join(dir, "app", "login", "page.tsx")),
  )
  assert.ok(appDir, `could not locate the web app from ${process.cwd()}`)

  for (const file of boundaries) {
    const source = readFileSync(join(appDir, file), "utf8")
    assert.match(
      source,
      /window\.location\.(assign|replace)\(/,
      `${file} must leave the page with a full document navigation`,
    )
    assert.doesNotMatch(
      source,
      /router\.(push|replace)\(/,
      `${file} must not navigate the session change client-side`,
    )
  }
})

test("the next member reads fresh data, never the previous member's", async () => {
  setCachedRequest("/api/notifications", { unread_count: 7 }, "user-a")
  resetClientSessionCaches()

  let calls = 0
  stubFetch(() => {
    calls += 1
    return new Response(JSON.stringify({ unread_count: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  initRequestCache("user-b")
  assert.equal(getCachedRequest("/api/notifications", "user-b"), undefined)

  const data = await fetchJsonCached<{ unread_count: number }>(
    "/api/notifications",
    {},
    "user-b",
  )
  assert.equal(calls, 1)
  assert.equal(data.unread_count, 1)
})
