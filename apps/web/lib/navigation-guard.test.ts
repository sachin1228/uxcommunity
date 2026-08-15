import assert from "node:assert/strict"
import test, { beforeEach } from "node:test"

import {
  allowBack,
  allowNavigation,
  createNavigationGuard,
  installLinkClickGuard,
  resetNavigationGuard,
  settleNavigation,
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

test("allowNavigation blocks navigating to the current route", () => {
  assert.equal(
    allowNavigation("/dashboard/communities", NAVIGATION_LOCK_MS, "/dashboard/communities"),
    false,
  )
  // Trailing slash and query/hash are ignored when comparing routes.
  assert.equal(
    allowNavigation("/dashboard/communities", NAVIGATION_LOCK_MS, "/dashboard/communities/"),
    false,
  )
  assert.equal(
    allowNavigation("/dashboard/communities", NAVIGATION_LOCK_MS, "/dashboard/communities?tab=a"),
    false,
  )
  // A sub-route is a different destination — navigating is allowed.
  assert.equal(
    allowNavigation("/dashboard/communities", NAVIGATION_LOCK_MS, "/dashboard/communities/c1"),
    true,
  )
})

test("guarded router no-ops a push to the current route", () => {
  const pushed: string[] = []
  const guard = createNavigationGuard(
    routerWith(pushed),
    NAVIGATION_LOCK_MS,
    "/dashboard/communities",
  )

  guard.push("/dashboard/communities")
  guard.push("/dashboard/communities/c1")

  assert.deepEqual(pushed, ["/dashboard/communities/c1"])
})

test("settleNavigation releases the lock once the route settles", () => {
  const clock = freezeTime(1_000_000)

  assert.equal(allowNavigation("/a"), true)
  assert.equal(allowNavigation("/a"), false, "lock is held while pending")
  settleNavigation("/a")
  assert.equal(allowNavigation("/a"), true, "settled route unlocks immediately")

  clock.restore()
})

test("link click guard swallows clicks on the current-route link", () => {
  const listeners: Array<{ type: string; fn: (e: unknown) => void; capture: boolean }> = []
  ;(globalThis as { document?: unknown }).document = {
    addEventListener: (type: string, fn: (e: unknown) => void, capture: boolean) => {
      listeners.push({ type, fn, capture })
    },
    removeEventListener: () => undefined,
  }
  const windowLike = { location: { pathname: "/dashboard/communities" } }
  ;(globalThis as unknown as { window?: unknown }).window = windowLike

  const cleanup = installLinkClickGuard(800)
  const handler = listeners.find((l) => l.type === "click")!.fn

  const makeClick = (href: string) => {
    const event: Record<string, unknown> = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ getAttribute: () => href }) },
    }
    event.preventDefault = () => { event.defaultPrevented = true }
    event.stopImmediatePropagation = () => { event.stopped = true }
    return event
  }

  const sameRoute = makeClick("/dashboard/communities")
  handler(sameRoute)
  assert.equal(sameRoute.defaultPrevented, true, "clicking the current route is a no-op")

  const otherRoute = makeClick("/dashboard/communities/c1")
  handler(otherRoute)
  assert.equal(otherRoute.defaultPrevented, false, "different destination is allowed")

  cleanup()
  delete (globalThis as { document?: unknown }).document
  delete (globalThis as unknown as { window?: unknown }).window
})

test("link click guard swallows rapid duplicate clicks on the same internal link", () => {
  // Minimal DOM stand-in so the guard's document listener can be exercised.
  const listeners: Array<{ type: string; fn: (e: unknown) => void; capture: boolean }> = []
  ;(globalThis as { document?: unknown }).document = {
    addEventListener: (type: string, fn: (e: unknown) => void, capture: boolean) => {
      listeners.push({ type, fn, capture })
    },
    removeEventListener: () => undefined,
  }

  const cleanup = installLinkClickGuard(800)
  const handler = listeners.find((l) => l.type === "click")!.fn

  const makeClick = () => {
    const event: Record<string, unknown> = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: {
        closest: (selector: string) =>
          selector === "a[href]"
            ? { getAttribute: () => "/dashboard/communities/c1" }
            : null,
      },
    }
    event.preventDefault = () => { event.defaultPrevented = true }
    event.stopImmediatePropagation = () => { event.stopped = true }
    return event
  }

  const first = makeClick()
  handler(first)
  assert.equal(first.defaultPrevented, false, "first click starts navigation")

  const duplicate = makeClick()
  handler(duplicate)
  assert.equal(duplicate.defaultPrevented, true, "duplicate click is swallowed")

  const otherHref = makeClick()
  otherHref.target = { closest: () => ({ getAttribute: () => "/dashboard/communities/c2" }) }
  handler(otherHref)
  assert.equal(otherHref.defaultPrevented, false, "different destination is allowed")

  cleanup()
  delete (globalThis as { document?: unknown }).document
})
