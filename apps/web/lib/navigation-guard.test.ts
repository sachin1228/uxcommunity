import assert from "node:assert/strict"
import test, { beforeEach } from "node:test"

import {
  allowBack,
  allowNavigation,
  createNavigationGuard,
  resetNavigationGuard,
  type RouterLike,
  NAVIGATION_LOCK_MS,
  BACK_LOCK_MS,
} from "./navigation-guard"

// Every test runs against module-level guard state — reset it so tests are
// independent of each other and of real wall-clock time.
beforeEach(() => {
  resetNavigationGuard()
})

const originalNow = Date.now

function freezeTime(at: number) {
  // Deterministic clock so lock expiry is testable without real waits.
  let now = at
  Date.now = () => now
  return {
    advance(ms: number) {
      now += ms
    },
    restore() {
      Date.now = originalNow
    },
  }
}

function routerWith(pushed: string[] = []): RouterLike {
  return {
    push: (href) => pushed.push(href),
    replace: () => {},
    back: () => {},
  }
}

test("10 rapid pushes to the same destination collapse to one navigation", () => {
  const clock = freezeTime(1_000_000)
  const pushed: string[] = []
  const guard = createNavigationGuard(routerWith(pushed))

  for (let i = 0; i < 10; i += 1) {
    guard.push("/dashboard/communities/c1")
    clock.advance(5)
  }

  assert.equal(pushed.length, 1)
  clock.restore()
})

test("a second push to a different destination is allowed", () => {
  const pushed: string[] = []
  const guard = createNavigationGuard(routerWith(pushed))

  guard.push("/a")
  guard.push("/b")

  assert.deepEqual(pushed, ["/a", "/b"])
})

test("the lock expires and the same destination can be navigated again", () => {
  const clock = freezeTime(1_000_000)
  const pushed: string[] = []
  const guard = createNavigationGuard(routerWith(pushed))

  guard.push("/a")
  clock.advance(NAVIGATION_LOCK_MS + 1)
  guard.push("/a")

  assert.deepEqual(pushed, ["/a", "/a"])
  clock.restore()
})

test("replace is guarded like push", () => {
  const clock = freezeTime(1_000_000)
  const replaced: string[] = []
  const router: RouterLike = {
    push: () => {},
    replace: (href) => replaced.push(href),
    back: () => {},
  }
  const guard = createNavigationGuard(router)

  guard.replace("/settings")
  guard.replace("/settings")
  guard.replace("/settings")

  assert.equal(replaced.length, 1)
  clock.restore()
})

test("double back is swallowed but a later back is allowed", () => {
  const clock = freezeTime(1_000_000)
  let backs = 0
  const router: RouterLike = { push: () => {}, replace: () => {}, back: () => { backs += 1 } }
  const guard = createNavigationGuard(router)

  guard.back()
  guard.back()
  assert.equal(backs, 1)

  clock.advance(BACK_LOCK_MS + 1)
  guard.back()
  assert.equal(backs, 2)
  clock.restore()
})

test("allowNavigation records the first navigation and blocks duplicates", () => {
  assert.equal(allowNavigation("/x"), true)
  assert.equal(allowNavigation("/x"), false)
})
