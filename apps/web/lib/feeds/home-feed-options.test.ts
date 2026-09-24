import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_SCOPES,
  HOME_FEED_SCOPE_STORAGE_KEY,
  HOME_FEED_TAB_SCOPES,
  isHomeFeedScope,
  readStoredHomeFeedScope,
  storeHomeFeedScope,
} from "./home-feed-options"

/** Minimal localStorage stand-in — the module reaches storage through `window`. */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  ;(globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
  }
  return store
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

test("the default feed is one of the switcher's tabs", () => {
  assert.ok((HOME_FEED_TAB_SCOPES as readonly string[]).includes(DEFAULT_HOME_FEED_SCOPE))
  for (const scope of HOME_FEED_TAB_SCOPES) {
    assert.ok(isHomeFeedScope(scope), `${scope} is a valid scope`)
  }
})

test("a stored legacy `all` choice opens the feed that replaced it", () => {
  stubStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: "all" })
  assert.equal(readStoredHomeFeedScope(), DEFAULT_HOME_FEED_SCOPE)
})

test("a stored tab choice is returned as-is", () => {
  stubStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: "communities" })
  assert.equal(readStoredHomeFeedScope(), "communities")
})

test("an unknown or missing stored value falls back to the default", () => {
  stubStorage()
  assert.equal(readStoredHomeFeedScope(), null)

  stubStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: "yesterday" })
  assert.equal(readStoredHomeFeedScope(), null)
})

test("the chosen tab round-trips through storage", () => {
  const store = stubStorage()
  storeHomeFeedScope("communities")
  assert.equal(store.get(HOME_FEED_SCOPE_STORAGE_KEY), "communities")

  storeHomeFeedScope(DEFAULT_HOME_FEED_SCOPE)
  assert.equal(readStoredHomeFeedScope(), DEFAULT_HOME_FEED_SCOPE)
})

test("unavailable storage never throws and yields no stored choice", () => {
  ;(globalThis as unknown as { window?: unknown }).window = {
    get localStorage(): never {
      throw new Error("storage blocked")
    },
  }

  assert.equal(readStoredHomeFeedScope(), null)
  assert.doesNotThrow(() => storeHomeFeedScope("public"))
})

test("every scope value is distinct", () => {
  assert.equal(new Set(HOME_FEED_SCOPES).size, HOME_FEED_SCOPES.length)
})
