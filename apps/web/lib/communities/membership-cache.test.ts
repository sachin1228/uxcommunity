import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  clearMembershipCache,
  getMembershipCached,
  invalidateMembership,
} from "./membership-cache"

afterEach(() => clearMembershipCache())

test("caches membership and non-membership results", async () => {
  let calls = 0
  const member = await getMembershipCached("community-a", "user-a", async () => {
    calls += 1
    return true
  })
  const cached = await getMembershipCached("community-a", "user-a", async () => {
    calls += 1
    return false
  })

  assert.deepEqual(member, { isMember: true, status: "miss" })
  assert.deepEqual(cached, { isMember: true, status: "hit" })
  assert.equal(calls, 1)
})

test("deduplicates concurrent membership lookups", async () => {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const load = async () => {
    calls += 1
    await gate
    return true
  }

  const first = getMembershipCached("community-a", "user-a", load)
  const second = getMembershipCached("community-a", "user-a", load)
  release()

  assert.equal((await first).status, "miss")
  assert.equal((await second).status, "dedup")
  assert.equal(calls, 1)
})

test("does not cache loader errors", async () => {
  let calls = 0
  const load = async () => {
    calls += 1
    if (calls === 1) throw new Error("database unavailable")
    return true
  }

  await assert.rejects(getMembershipCached("community-a", "user-a", load))
  assert.equal((await getMembershipCached("community-a", "user-a", load)).isMember, true)
  assert.equal(calls, 2)
})

test("reloads after targeted invalidation", async () => {
  let isMember = false
  const load = async () => isMember

  assert.equal((await getMembershipCached("community-a", "user-a", load)).isMember, false)
  isMember = true
  invalidateMembership("community-a", "user-a")
  assert.equal((await getMembershipCached("community-a", "user-a", load)).isMember, true)
})
