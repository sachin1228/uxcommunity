import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import { clearUserStatusCache, getUserStatusCached } from "./user-status-cache"

afterEach(() => clearUserStatusCache())

test("deduplicates concurrent status lookups per user", async () => {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const load = async () => {
    calls += 1
    await gate
    return { exists: true, is_blocked: false }
  }

  const first = getUserStatusCached("user-a", load)
  const second = getUserStatusCached("user-a", load)
  release()

  assert.deepEqual(await first, await second)
  assert.equal(calls, 1)
})

test("reuses a live entry and isolates users", async () => {
  let calls = 0
  const load = async () => {
    calls += 1
    return { exists: true, is_blocked: false }
  }

  await getUserStatusCached("user-a", load, { ttlMs: 1_000, now: 100 })
  await getUserStatusCached("user-a", load, { ttlMs: 1_000, now: 200 })
  await getUserStatusCached("user-b", load, { ttlMs: 1_000, now: 200 })

  assert.equal(calls, 2)
})

test("reloads an expired entry", async () => {
  let calls = 0
  const load = async () => ({ exists: true, is_blocked: ++calls > 1 })

  await getUserStatusCached("user-a", load, { ttlMs: 1, now: 0 })
  const refreshed = await getUserStatusCached("user-a", load, { ttlMs: 1, now: Date.now() + 10 })

  assert.equal(calls, 2)
  assert.equal(refreshed.is_blocked, true)
})
