import assert from "node:assert/strict"
import test from "node:test"

import { createContentEventIdCache } from "./content-event-ids"

test("caches ids per community within the TTL (audit M-11)", async () => {
  let calls = 0
  let clock = 0
  const cache = createContentEventIdCache(
    async (communityId) => {
      calls += 1
      return [`${communityId}-1`, `${communityId}-2`]
    },
    { ttlMs: 60_000, now: () => clock },
  )

  assert.deepEqual(await cache.load("c1"), ["c1-1", "c1-2"])
  clock = 30_000
  assert.deepEqual(await cache.load("c1"), ["c1-1", "c1-2"])
  assert.equal(calls, 1, "a second fetch inside the window must not hit the database")

  // A different community is independent.
  await cache.load("c2")
  assert.equal(calls, 2)
})

test("reloads once the TTL expires", async () => {
  let calls = 0
  let clock = 0
  const cache = createContentEventIdCache(
    async () => {
      calls += 1
      return [`id-${calls}`]
    },
    { ttlMs: 1_000, now: () => clock },
  )

  await cache.load("c1")
  clock = 999
  await cache.load("c1")
  assert.equal(calls, 1)

  clock = 1_000
  assert.deepEqual(await cache.load("c1"), ["id-2"])
  assert.equal(calls, 2)
})

test("deduplicates concurrent first loads for the same community", async () => {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const cache = createContentEventIdCache(
    async () => {
      calls += 1
      await gate
      return ["a", "b"]
    },
    { ttlMs: 60_000, now: () => 0 },
  )

  const first = cache.load("c1")
  const second = cache.load("c1")
  release()

  assert.deepEqual(await first, await second)
  assert.equal(calls, 1)
})

test("stays bounded by evicting the least-recently-used community", async () => {
  let calls = 0
  const cache = createContentEventIdCache(
    async (communityId) => {
      calls += 1
      return [`${communityId}-${calls}`]
    },
    { ttlMs: 60_000, maxEntries: 2, now: () => 0 },
  )

  await cache.load("a")
  await cache.load("b")
  await cache.load("a") // touch a so b is the LRU
  await cache.load("c") // evicts b

  assert.equal(cache.size, 2)

  const before = calls
  await cache.load("a") // still cached (touched, so not the eviction victim)
  assert.equal(calls, before)
  await cache.load("b") // was evicted — must reload
  assert.equal(calls, before + 1)
})

test("invalidate drops a single community", async () => {
  let calls = 0
  const cache = createContentEventIdCache(
    async () => {
      calls += 1
      return []
    },
    { ttlMs: 60_000, now: () => 0 },
  )

  await cache.load("c1")
  cache.invalidate("c1")
  await cache.load("c1")
  assert.equal(calls, 2)
})
