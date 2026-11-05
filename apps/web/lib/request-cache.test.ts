import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  canonicalRequestKey,
  clearRequestCache,
  fetchAndHydrateCommunityBootstrap,
  fetchAndHydrateCommunityContentEvents,
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  invalidateRequest,
  patchCachedRequest,
  setCachedRequest,
  staleTimeForRequest,
} from "./request-cache"

const originalFetch = globalThis.fetch
const originalAnimationFrame = globalThis.requestAnimationFrame

for (const [name, body] of [
  ["empty", ""],
  ["HTML", "<!doctype html><html>Temporarily unavailable</html>"],
  ["truncated JSON", '{"items":'],
  ["null JSON", "null"],
]) {
  test(`rejects a successful ${name} response without caching it and allows a fresh retry`, async () => {
    const url = "/api/home/feed?scope=all"
    const page = { items: [{ id: "post-a" }] }
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls === 1 ? new Response(body, { status: 200 }) : Response.json(page)
    }) as typeof fetch

    await assert.rejects(fetchJsonCached(url, {}, "user-a"), /invalid response/i)
    assert.equal(getCachedRequest(url, "user-a"), undefined)
    assert.deepEqual(await fetchJsonCached(url, {}, "user-a"), page)
    assert.deepEqual(await fetchJsonCached(url, {}, "user-a"), page)
    assert.equal(calls, 2, "only the valid response should be reused")
  })
}

test("a failed response parse preserves the last valid cached feed", async () => {
  const url = "/api/home/feed?scope=all"
  const page = { items: [{ id: "post-a" }] }
  setCachedRequest(url, page, "user-a")
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch

  await assert.rejects(fetchJsonCached(url, { force: true }, "user-a"), /invalid response/i)
  assert.deepEqual(getCachedRequest(url, "user-a"), page)
})

test("a valid empty feed is cached and reused", async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return Response.json({ items: [] })
  }) as typeof fetch

  assert.deepEqual(await fetchJsonCached("/api/home/feed", {}, "user-a"), { items: [] })
  assert.deepEqual(await fetchJsonCached("/api/home/feed", {}, "user-a"), { items: [] })
  assert.equal(calls, 1)
})

test("preserves HTTP error messages and status even when the error body is not JSON", async () => {
  const url = "/api/home/feed"
  globalThis.fetch = (async () => Response.json({ error: "Sign in required" }, { status: 401 })) as typeof fetch
  await assert.rejects(fetchJsonCached(url, {}, "user-a"), { message: "Sign in required", status: 401 })

  globalThis.fetch = (async () => new Response("Bad Gateway", { status: 502 })) as typeof fetch
  await assert.rejects(fetchJsonCached(url, {}, "user-a"), { message: "Request failed (502)", status: 502 })
  assert.equal(getCachedRequest(url, "user-a"), undefined)
})

test("partial chat snapshots cannot satisfy full metadata or permission reads", async () => {
  const partial = { community: { id: "a", details_loaded: false }, members: [] }
  globalThis.fetch = (async () => Response.json({
    community: partial, messages: { messages: [{ id: "message-a" }] }, unreadCount: 0,
  })) as typeof fetch
  await fetchAndHydrateCommunityBootstrap("a", "user-a")
  assert.deepEqual(getCachedRequest("/api/communities/a/chat", "user-a"), partial)
  assert.equal(getCachedRequest("/api/communities/a", "user-a"), undefined)
  assert.equal(getCachedRequest("/api/communities/a/permissions", "user-a"), undefined)
  assert.deepEqual(getCachedRequest("/api/communities/a/messages", "user-a"), { messages: [{ id: "message-a" }] })
})

test("chat and sidebar share a details request after the snapshot has a paint opportunity", async () => {
  const calls: string[] = []
  const frames: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length }
  const full = { community: { id: "a", details_loaded: true, member_count: 12 }, members: [{ user_id: "member" }] }
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  globalThis.fetch = (async (url) => {
    calls.push(String(url))
    if (String(url).endsWith("/bootstrap")) return Response.json({
      community: { community: { id: "a", details_loaded: false }, members: [] },
      messages: { messages: [{ id: "message-a" }] }, unreadCount: 0,
    })
    await gate
    return Response.json(full)
  }) as typeof fetch
  const chat = fetchJsonCached("/api/communities/a", {}, "user-a")
  const sidebar = fetchJsonCached("/api/communities/a", {}, "user-a")
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ["/api/communities/a/bootstrap"])
  assert.deepEqual(getCachedRequest("/api/communities/a/messages", "user-a"), { messages: [{ id: "message-a" }] })
  frames.splice(0).forEach((callback) => callback(0))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 1, 'details cannot begin in the first pre-paint callback')
  frames.splice(0).forEach((callback) => callback(0))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ["/api/communities/a/bootstrap", "/api/communities/a"])
  release()
  assert.deepEqual(await chat, full)
  assert.deepEqual(await sidebar, full)
  assert.deepEqual(getCachedRequest("/api/communities/a", "user-a"), full)
})

test("replaying a partial bootstrap preserves already loaded details", async () => {
  const full = { community: { id: "a", details_loaded: true, member_count: 12 }, members: [] }
  setCachedRequest("/api/communities/a", full, "user-a")
  globalThis.fetch = (async () => Response.json({
    community: { community: { id: "a", details_loaded: false }, members: [] },
    messages: { messages: [] }, unreadCount: 0,
  })) as typeof fetch
  await fetchAndHydrateCommunityBootstrap("a", "user-a")
  assert.deepEqual(getCachedRequest("/api/communities/a", "user-a"), full)
})

test("failed deferred details leave the critical snapshot usable and can be retried", async () => {
  const partial = { community: { id: "a", details_loaded: false }, members: [] }
  let failDetails = true
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith("/bootstrap")) return Response.json({
      community: partial, messages: { messages: [{ id: "message-a" }] }, unreadCount: 0,
    })
    return failDetails ? Response.json({ error: "Unavailable" }, { status: 502 })
      : Response.json({ community: { id: "a", details_loaded: true }, members: [] })
  }) as typeof fetch
  await assert.rejects(fetchJsonCached("/api/communities/a", {}, "user-a"), /Unavailable/)
  assert.deepEqual(getCachedRequest("/api/communities/a/chat", "user-a"), partial)
  assert.deepEqual(getCachedRequest("/api/communities/a/messages", "user-a"), { messages: [{ id: "message-a" }] })
  failDetails = false
  const result = await fetchJsonCached<{ community: { details_loaded: boolean } }>("/api/communities/a", {}, "user-a")
  assert.equal(result.community.details_loaded, true)
})

test("chat bootstrap requests only the critical web snapshot", async () => {
  let headers: Headers | undefined
  globalThis.fetch = (async (_url, options) => {
    headers = new Headers(options?.headers)
    return Response.json({ community: {}, messages: { messages: [] }, permissions: {}, unreadCount: 0 })
  }) as typeof fetch
  await fetchAndHydrateCommunityBootstrap("a", "user-a")
  assert.equal(headers?.get("X-Community-Bootstrap"), "chat")
})

test("slow timeline history does not block the message snapshot", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const calls: string[] = []
  globalThis.fetch = (async (url) => {
    calls.push(String(url))
    if (String(url).includes("section=content-events")) {
      await gate
      return Response.json({ "content-events": { events: [{ id: "event-a" }] } })
    }
    return Response.json({ community: {}, messages: { messages: [{ id: "message-a" }] }, permissions: {}, unreadCount: 0 })
  }) as typeof fetch
  const history = fetchAndHydrateCommunityContentEvents("a", "user-a")
  const snapshot = await fetchAndHydrateCommunityBootstrap("a", "user-a")
  assert.deepEqual(snapshot.messages, { messages: [{ id: "message-a" }] })
  release()
  assert.deepEqual(await history, { events: [{ id: "event-a" }] })
  assert.deepEqual(calls, ["/api/communities/a/bootstrap", "/api/communities/a/bootstrap?section=content-events"])

  // Mutations patch this canonical snapshot; a later visit must see the patch.
  patchCachedRequest("/api/communities/a/bootstrap", (value: typeof snapshot) => ({
    ...value, "content-events": { events: [] },
  }), "user-a")
  assert.deepEqual(await fetchAndHydrateCommunityContentEvents("a", "user-a"), { events: [] })
  assert.equal(calls.length, 2)

  invalidateRequest("/api/communities/a/bootstrap", "user-a")
  await fetchAndHydrateCommunityContentEvents("a", "user-a")
  assert.equal(calls.length, 4, "a new core snapshot must not reuse old secondary history")
})

test("a delete while history is pending survives hydration and a later cached visit", async () => {
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const secondaryStarted = new Promise<void>((resolve) => { started = resolve })
  globalThis.fetch = (async (url) => {
    if (String(url).includes("section=content-events")) {
      started()
      await gate
      return Response.json({ "content-events": { events: [{ id: "deleted" }] } })
    }
    return Response.json({ community: {}, messages: { messages: [] }, permissions: {}, unreadCount: 0 })
  }) as typeof fetch
  const pending = fetchAndHydrateCommunityContentEvents("a", "user-a")
  await secondaryStarted
  patchCachedRequest("/api/communities/a/bootstrap", (current) => ({
    ...current as object, contentEventChanges: { deleted: null },
  }), "user-a")
  release()
  assert.deepEqual(await pending, { events: [] })
  assert.deepEqual(await fetchAndHydrateCommunityContentEvents("a", "user-a"), { events: [] })
  assert.deepEqual(getCachedRequest("/api/communities/a/content-events", "user-a"), { events: [] })
})

test("a local mutation before history starts is not mistaken for complete history", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (url) => {
    calls.push(String(url))
    return Response.json({ "content-events": { events: [{ id: "keep" }, { id: "deleted" }] } })
  }) as typeof fetch
  setCachedRequest("/api/communities/a/bootstrap", {
    community: {}, messages: { messages: [] }, permissions: {}, unreadCount: 0,
    "content-events": { events: [] }, contentEventsLoaded: false,
    contentEventChanges: { deleted: null },
  }, "user-a")
  assert.deepEqual(await fetchAndHydrateCommunityContentEvents("a", "user-a"), { events: [{ id: "keep" }] })
  assert.deepEqual(calls, ["/api/communities/a/bootstrap?section=content-events"])
})

afterEach(() => {
  clearRequestCache()
  globalThis.fetch = originalFetch
  globalThis.requestAnimationFrame = originalAnimationFrame
})

test("uses dashboard-specific stale windows", () => {
  assert.equal(staleTimeForRequest("/api/communities"), 60_000)
  assert.equal(staleTimeForRequest("/api/communities?archived=false"), 60_000)
  assert.equal(staleTimeForRequest("/api/home/feed"), 60_000)
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

test("an invalidation supersedes a read that was already in flight", async () => {
  const url = "/api/dm/unread"
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  globalThis.fetch = (async () => {
    const value = ++calls
    if (value === 1) await gate
    return Response.json({ count: value })
  }) as typeof fetch

  // Started before the mutation; it answers with the pre-mutation count.
  const stale = fetchJsonCached<{ count: number }>(url, {}, "user-a")
  invalidateRequest(url, "user-a")
  const fresh = fetchJsonCached<{ count: number }>(url, { force: true }, "user-a")

  release()
  assert.equal((await stale).count, 1)
  assert.equal((await fresh).count, 2)
  assert.equal(calls, 2, "the post-invalidation read is a new request")
  assert.deepEqual(
    getCachedRequest(url, "user-a"),
    { count: 2 },
    "the stale response must not repopulate the cache",
  )
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
