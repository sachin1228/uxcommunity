import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  canonicalRequestKey,
  clearRequestCache,
  fetchAndHydrateCommunityBootstrap,
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  invalidateRequest,
  patchCachedRequest,
  setCachedRequest,
  staleTimeForRequest,
} from "./request-cache"

const originalFetch = globalThis.fetch

afterEach(() => {
  clearRequestCache()
  globalThis.fetch = originalFetch
})

test("uses dashboard-specific stale windows", () => {
  assert.equal(staleTimeForRequest("/api/communities"), 60_000)
  assert.equal(staleTimeForRequest("/api/communities?archived=false"), 60_000)
  assert.equal(staleTimeForRequest("/api/home/feed"), 30_000)
  assert.equal(staleTimeForRequest("/api/notifications"), 30_000)
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

test("deduplicates concurrent optional-section fallback requests", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return new Response(JSON.stringify({ value: calls }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await Promise.all([
    fetchJsonCached("/api/communities/community-a/events", {}, "user-a"),
    fetchJsonCached("/api/communities/community-a/events", {}, "user-a"),
    fetchJsonCached("/api/communities/community-a/events", {}, "user-a"),
  ])

  assert.equal(calls, 2)
})

test("deduplicates stale revalidation", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ value: calls }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await fetchJsonCached("/api/feed", {}, "user-a")
  await Promise.all([
    fetchJsonCached("/api/feed", { staleMs: 0 }, "user-a"),
    fetchJsonCached("/api/feed", { staleMs: 0 }, "user-a"),
  ])

  assert.equal(calls, 2)
})

test("does not deduplicate user-specific requests across users", async () => {
  let calls = 0
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ value: ++calls }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )) as typeof fetch

  await Promise.all([
    fetchJsonCached("/api/notifications", {}, "user-a"),
    fetchJsonCached("/api/notifications", {}, "user-b"),
  ])

  assert.equal(calls, 2)
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

test("seeds canonical event state without a network request", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(JSON.stringify({ saved: false, save_count: 0 }))
  }) as typeof fetch

  const url = "/api/communities/community-a/events/event-a/save"
  setCachedRequest(url, { saved: true, save_count: 3 }, "user-a")

  const value = await fetchJsonCached<{ saved: boolean; save_count: number }>(url, {}, "user-a")
  assert.deepEqual(value, { saved: true, save_count: 3 })
  assert.equal(calls, 0)
  assert.equal(getCachedRequest(url, "user-b"), undefined)
})

test("deduplicates identical message cursors and preserves distinct pagination keys", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input) => {
    calls.push(String(input))
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  const afterA = "/api/communities/community-a/messages?after=2026-01-01T00%3A00%3A00.000Z"
  const afterEquivalent = "/api/communities/community-a/messages?after=2026-01-01T00%3A00%3A00.000Z"
  const before = "/api/communities/community-a/messages?before=2026-01-01T00%3A00%3A00.000Z"

  await Promise.all([
    fetchJsonCached(afterA, {}, "user-a"),
    fetchJsonCached(afterEquivalent, {}, "user-a"),
    fetchJsonCached(before, {}, "user-a"),
  ])

  assert.equal(calls.length, 2)
  assert.equal(calls.filter((url) => url === afterA).length, 1)
  assert.equal(calls.filter((url) => url === before).length, 1)
})

test("reuses SSR-seeded community metadata and messages", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(JSON.stringify({}), { status: 200 })
  }) as typeof fetch

  setCachedRequest(
    "/api/communities/community-a",
    { community: { id: "community-a" }, members: [] },
    "user-a",
  )
  setCachedRequest(
    "/api/communities/community-a/messages",
    { messages: [{ id: "message-a" }] },
    "user-a",
  )

  const [metadata, messages] = await Promise.all([
    fetchJsonCached<{ community: { id: string } }>(
      "/api/communities/community-a",
      {},
      "user-a",
    ),
    fetchJsonCached<{ messages: Array<{ id: string }> }>(
      "/api/communities/community-a/messages",
      {},
      "user-a",
    ),
  ])

  assert.equal(metadata.community.id, "community-a")
  assert.equal(messages.messages[0]?.id, "message-a")
  assert.equal(calls, 0)
})

test("hydrates every supplied community bootstrap section into canonical user keys", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify({
      community: { community: { id: "community-a" }, members: [] },
      messages: { messages: [{ id: "message-a" }] },
      permissions: { role: "member", can_manage: false },
      unreadCount: 2,
      threads: { threads: [{ id: "thread-a" }] },
      events: { events: [{ id: "event-a" }] },
      resources: { resources: [{ id: "resource-a" }] },
      showcase: { posts: [{ id: "showcase-a" }], nextCursor: null },
      members: { members: [{ user_id: "member-a" }], has_more: false },
      rules: { rules: [{ id: "rule-a" }] },
      stats: { posts_today: 3 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await fetchAndHydrateCommunityBootstrap("community-a", "user-a")

  const urls = [
    "/api/communities/community-a",
    "/api/communities/community-a/messages",
    "/api/communities/community-a/permissions",
    "/api/communities/community-a/unread",
    "/api/communities/community-a/threads",
    "/api/communities/community-a/events",
    "/api/communities/community-a/resources",
    "/api/communities/community-a/showcase",
    "/api/communities/community-a/members?page=0",
    "/api/communities/community-a/rules",
    "/api/communities/community-a/stats",
  ]
  await Promise.all(urls.map((url) => fetchJsonCached(url, {}, "user-a")))

  assert.deepEqual(calls, ["/api/communities/community-a/bootstrap"])
  assert.equal(
    getCachedRequest<{ members: Array<{ user_id: string }> }>(
      "/api/communities/community-a/members?page=0",
      "user-a",
    )?.members[0]?.user_id,
    "member-a",
  )
  assert.equal(
    getCachedRequest<{ posts_today: number }>(
      "/api/communities/community-a/stats",
      "user-a",
    )?.posts_today,
    3,
  )
  assert.equal(getCachedRequest(urls[4], "user-b"), undefined)
})

test("coordinates concurrent bootstrap-backed reads through one bootstrap request", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input) => {
    calls.push(String(input))
    await new Promise((resolve) => setTimeout(resolve, 10))
    return new Response(JSON.stringify({
      community: { community: { id: "community-a" }, members: [] },
      messages: { messages: [{ id: "message-a" }] },
      permissions: { role: "member", can_manage: false },
      unreadCount: 2,
      threads: { threads: [{ id: "thread-a" }] },
      events: { events: [{ id: "event-a" }] },
      resources: { resources: [{ id: "resource-a" }] },
      showcase: { posts: [{ id: "showcase-a" }], nextCursor: null },
      members: { members: [{ user_id: "member-a" }], has_more: false },
      rules: { rules: [{ id: "rule-a" }] },
      stats: { posts_today: 3 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  const base = "/api/communities/community-a"
  const urls = [
    base,
    `${base}/messages`,
    `${base}/permissions`,
    `${base}/unread`,
    `${base}/showcase`,
    `${base}/threads`,
    `${base}/events`,
    `${base}/resources`,
    `${base}/members?page=0`,
    `${base}/rules`,
    `${base}/stats`,
  ]
  const values = await Promise.all(
    urls.map((url) => fetchJsonCached<unknown>(url, {}, "user-a")),
  )

  assert.equal(values.length, urls.length)
  assert.deepEqual(calls, [`${base}/bootstrap`])
})

test("falls back once when an optional bootstrap section is absent", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input) => {
    const url = String(input)
    calls.push(url)
    const body = url.endsWith("/bootstrap")
      ? {
          community: { community: { id: "community-a" }, members: [] },
          messages: { messages: [] },
          permissions: { role: "member", can_manage: false },
          unreadCount: 0,
        }
      : { threads: [{ id: "thread-fallback" }] }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  const value = await fetchJsonCached<{ threads: Array<{ id: string }> }>(
    "/api/communities/community-a/threads",
    {},
    "user-a",
  )

  assert.equal(value.threads[0]?.id, "thread-fallback")
  assert.deepEqual(calls, [
    "/api/communities/community-a/bootstrap",
    "/api/communities/community-a/threads",
  ])
})

test("leaves absent optional bootstrap sections uncached", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    community: { community: { id: "community-a" }, members: [] },
    messages: { messages: [] },
    permissions: { role: "member", can_manage: false },
    unreadCount: 0,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch

  await fetchAndHydrateCommunityBootstrap("community-a", "user-a")

  assert.equal(getCachedRequest("/api/communities/community-a/threads", "user-a"), undefined)
  assert.equal(getCachedRequest("/api/communities/community-a/members?page=0", "user-a"), undefined)
})

test("hydrates a secondary community collection from bootstrap", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ threads: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  await Promise.all([
    fetchJsonCached("/api/communities/community-a/threads", {}, "user-a"),
    fetchJsonCached("/api/communities/community-a/threads", {}, "user-a"),
  ])

  assert.deepEqual(calls, ["/api/communities/community-a/bootstrap"])
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
