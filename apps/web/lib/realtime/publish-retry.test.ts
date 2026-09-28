import assert from "node:assert/strict"
import test from "node:test"

import { backoffDelay, isRetryableStatus, retryWithBackoff } from "./publish-retry"

const POLICY = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitter: 0.25 }

function fakeDeps(random = () => 0.5) {
  const sleeps: number[] = []
  const retries: Array<{ attempt: number; delayMs: number }> = []
  return {
    sleeps,
    retries,
    deps: {
      sleep: async (ms: number) => { sleeps.push(ms) },
      random,
      onRetry: (info: { attempt: number; delayMs: number }) => retries.push(info),
    },
  }
}

test("returns the first successful result without retrying", async () => {
  let calls = 0
  const { sleeps, deps } = fakeDeps()
  const result = await retryWithBackoff(async () => { calls += 1; return "ok" }, POLICY, () => false, deps)
  assert.equal(result, "ok")
  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test("succeeds after a transient failure", async () => {
  let calls = 0
  const { sleeps, retries, deps } = fakeDeps()
  const result = await retryWithBackoff(
    async () => {
      calls += 1
      if (calls < 2) throw new Error("reset")
      return "recovered"
    },
    POLICY,
    ({ error }) => !!error,
    deps,
  )
  assert.equal(result, "recovered")
  assert.equal(calls, 2)
  assert.equal(sleeps.length, 1)
  assert.deepEqual(retries, [{ attempt: 1, delayMs: sleeps[0] }])
})

test("does not retry a permanent failure", async () => {
  let calls = 0
  const { sleeps, deps } = fakeDeps()
  await assert.rejects(
    () => retryWithBackoff(async () => { calls += 1; throw new Error("permanent") }, POLICY, () => false, deps),
    /permanent/,
  )
  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test("is bounded by the attempt count", async () => {
  let calls = 0
  const { sleeps, deps } = fakeDeps()
  await assert.rejects(
    () => retryWithBackoff(async () => { calls += 1; throw new Error("down") }, { ...POLICY, attempts: 3 }, () => true, deps),
    /down/,
  )
  assert.equal(calls, 3)
  assert.equal(sleeps.length, 2)
})

test("backoff grows exponentially with symmetric jitter", () => {
  assert.equal(backoffDelay(1, { ...POLICY, jitter: 0 }, () => 0.5), 100)
  assert.equal(backoffDelay(2, { ...POLICY, jitter: 0 }, () => 0.5), 200)
  assert.equal(backoffDelay(10, { ...POLICY, jitter: 0 }, () => 0.5), 1_000)
  assert.equal(backoffDelay(1, POLICY, () => 0), 75)
  assert.equal(backoffDelay(1, POLICY, () => 1), 125)
})

test("classifies retryable statuses", () => {
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(503), true)
  assert.equal(isRetryableStatus(400), false)
  assert.equal(isRetryableStatus(200), false)
})
