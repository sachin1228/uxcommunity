import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_FILTER_SCOPES,
  HOME_FEED_SCOPE_STORAGE_KEY,
  HOME_FEED_SCOPES,
  isHomeFeedFilterScope,
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
  delete (globalThis as unknown as { window?: unknown }).window
})

test("the feed opens on all posts and offers two filters", () => {
  assert.equal(DEFAULT_HOME_FEED_SCOPE, "all")
  assert.deepEqual([...HOME_FEED_FILTER_SCOPES], ["all", "communities"])
  for (const scope of HOME_FEED_FILTER_SCOPES) {
    assert.ok(isHomeFeedFilterScope(scope), `${scope} is a valid filter`)
  }
  assert.equal(isHomeFeedFilterScope("public"), false)
  // The API still accepts the retired public scope for older clients.
  assert.ok(isHomeFeedScope("public"))
})

test("a stored filter is returned as-is", () => {
  stubStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: "communities" })
  assert.equal(readStoredHomeFeedScope(), "communities")
})

test("a stored filter removed from the UI opens the unified feed", () => {
  stubStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: "public" })
  assert.equal(readStoredHomeFeedScope(), "all")
})

test("an unknown or missing stored value falls back to all posts", () => {
  stubStorage()
  assert.equal(readStoredHomeFeedScope(), null)

  stubStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: "yesterday" })
  assert.equal(readStoredHomeFeedScope(), null)
})

test("the chosen filter round-trips through storage", () => {
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
  assert.doesNotThrow(() => storeHomeFeedScope("all"))
})

test("every scope value is distinct", () => {
  assert.equal(new Set(HOME_FEED_SCOPES).size, HOME_FEED_SCOPES.length)
  assert.equal(new Set(HOME_FEED_FILTER_SCOPES).size, HOME_FEED_FILTER_SCOPES.length)
})
