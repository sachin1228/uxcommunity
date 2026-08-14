import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  THREAD_CACHE_TTL_MS,
  clearThreadRequestCache,
  fetchThreadResource,
  getThreadResource,
  invalidateThreadResources,
  patchThreadResource,
  seedThreadResource,
} from "./thread-request-cache"

const url = "/api/communities/community-1/threads/thread-1"

afterEach(() => {
  clearThreadRequestCache()
})

test("uses the required resource cache windows", () => {
  assert.deepEqual(THREAD_CACHE_TTL_MS, {
    detail: 60_000,
    comments: 30_000,
    reactions: 15_000,
  })
})

test("SSR seeding serves a thread without a network request", async () => {
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ thread: { id: "network" } }))
  }

  seedThreadResource(url, { thread: { id: "thread-1" } }, "user-1")
  const result = await fetchThreadResource<{ thread: { id: string } }>(url, {
    kind: "detail",
    userId: "user-1",
  })

  assert.equal(result.thread.id, "thread-1")
  assert.equal(requests, 0)
})

test("deduplicates concurrent requests and isolates users", async () => {
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify({ thread: { id: `request-${requests}` } }))
  }

  const [first, second] = await Promise.all([
    fetchThreadResource<{ thread: { id: string } }>(url, { kind: "detail", userId: "user-1" }),
    fetchThreadResource<{ thread: { id: string } }>(url, { kind: "detail", userId: "user-1" }),
  ])
  await fetchThreadResource(url, { kind: "detail", userId: "user-2" })

  assert.deepEqual(first, second)
  assert.equal(requests, 2)
})

test("returns stale data while one background revalidation updates consumers", async () => {
  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  let requests = 0
  let resolveUpdate!: (value: { thread: { id: string } }) => void
  const updated = new Promise<{ thread: { id: string } }>((resolve) => { resolveUpdate = resolve })
  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ thread: { id: "fresh" } }))
  }

  try {
    seedThreadResource(url, { thread: { id: "stale" } }, "user-1")
    now += THREAD_CACHE_TTL_MS.detail + 1
    const result = await fetchThreadResource<{ thread: { id: string } }>(url, {
      kind: "detail",
      userId: "user-1",
      onRevalidated: resolveUpdate,
    })

    assert.equal(result.thread.id, "stale")
    assert.equal((await updated).thread.id, "fresh")
    assert.equal(requests, 1)
  } finally {
    Date.now = realNow
  }
})

test("patches and invalidates all resources for a thread", () => {
  const commentsUrl = `${url}/comments`
  seedThreadResource(url, { thread: { id: "thread-1", vote_count: 1 } }, "user-1")
  seedThreadResource(commentsUrl, { comments: [] }, "user-1")
  patchThreadResource<{ thread: { id: string; vote_count: number } }>(
    url,
    "user-1",
    (current) => ({ ...current, thread: { ...current.thread, vote_count: 2 } }),
  )

  assert.equal(getThreadResource<{ thread: { vote_count: number } }>(url, "user-1")?.thread.vote_count, 2)
  invalidateThreadResources("thread-1", "user-1")
  assert.equal(getThreadResource(url, "user-1"), undefined)
  assert.equal(getThreadResource(commentsUrl, "user-1"), undefined)
})
