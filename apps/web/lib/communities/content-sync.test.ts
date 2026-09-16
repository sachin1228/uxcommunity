import assert from "node:assert/strict"
import test, { afterEach } from "node:test"

import {
  applyContentChanges,
  clearContentChanges,
  consumeContentChanges,
  pendingContentChangeCount,
  publishContentChange,
  subscribeContentChanges,
  type ContentChange,
} from "./content-sync"

afterEach(() => {
  clearContentChanges()
})

test("delivers a change to every subscribed list", () => {
  const first: ContentChange[] = []
  const second: ContentChange[] = []
  subscribeContentChanges((change) => first.push(change))
  subscribeContentChanges((change) => second.push(change))

  publishContentChange({ kind: "thread", id: "thread-a", patch: { user_liked: true, like_count: 4 } })

  assert.deepEqual(first, [{ kind: "thread", id: "thread-a", patch: { user_liked: true, like_count: 4 } }])
  assert.deepEqual(second, first)
})

test("stops delivering after unsubscribe", () => {
  let seen = 0
  const unsubscribe = subscribeContentChanges(() => { seen += 1 })

  publishContentChange({ kind: "event", id: "event-a", patch: { user_saved: true } })
  unsubscribe()
  publishContentChange({ kind: "event", id: "event-a", patch: { user_saved: false } })

  assert.equal(seen, 1)
})

test("applies field patches to the matching card and leaves others alone", () => {
  const items = [
    { id: "thread-a", _type: "thread", like_count: 1, user_liked: false },
    { id: "thread-b", _type: "thread", like_count: 7, user_liked: false },
  ]

  const next = applyContentChanges(
    items,
    [{ kind: "thread", id: "thread-a", patch: { like_count: 2, user_liked: true } }],
    (item) => item._type as "thread",
  )

  assert.deepEqual(next[0], { id: "thread-a", _type: "thread", like_count: 2, user_liked: true })
  assert.equal(next[1], items[1])
})

test("ignores a change whose kind does not match the list", () => {
  const items = [{ id: "shared-id", event: true }]

  const next = applyContentChanges(items, [{ kind: "thread", id: "shared-id", patch: { like_count: 9 } }], "event")

  assert.deepEqual(next, items)
  assert.equal(next[0], items[0])
})

test("drops deleted cards and keeps the rest", () => {
  const items = [{ id: "resource-a" }, { id: "resource-b" }]

  const next = applyContentChanges(items, [{ kind: "resource", id: "resource-a", removed: true }], "resource")

  assert.deepEqual(next, [{ id: "resource-b" }])
})

test("applying the same change twice is a no-op", () => {
  const items = [{ id: "showcase-a", like_count: 1 }]
  const changes: ContentChange[] = [{ kind: "showcase", id: "showcase-a", patch: { like_count: 3 } }]

  const once = applyContentChanges(items, changes, "showcase")
  const twice = applyContentChanges(once, changes, "showcase")

  assert.deepEqual(twice, once)
})

test("queues changes for lists that are not mounted yet", () => {
  publishContentChange({ kind: "thread", id: "thread-a", patch: { user_liked: true, like_count: 2 } })

  assert.equal(pendingContentChangeCount(), 1)

  const queued = consumeContentChanges("thread")
  assert.deepEqual(queued, [{ kind: "thread", id: "thread-a", patch: { user_liked: true, like_count: 2 } }])
  assert.equal(pendingContentChangeCount(), 0)
  assert.deepEqual(consumeContentChanges("thread"), [])
})

test("a single-kind list does not consume other kinds", () => {
  publishContentChange({ kind: "thread", id: "thread-a", patch: { user_saved: true } })
  publishContentChange({ kind: "event", id: "event-a", patch: { user_rsvped: true } })

  assert.deepEqual(consumeContentChanges("thread"), [
    { kind: "thread", id: "thread-a", patch: { user_saved: true } },
  ])
  assert.equal(pendingContentChangeCount(), 1)

  assert.deepEqual(consumeContentChanges(null), [
    { kind: "event", id: "event-a", patch: { user_rsvped: true } },
  ])
})

test("merges repeated changes for one card and lets a delete win", () => {
  publishContentChange({ kind: "thread", id: "thread-a", patch: { like_count: 2 } })
  publishContentChange({ kind: "thread", id: "thread-a", patch: { user_liked: true } })

  assert.deepEqual(consumeContentChanges("thread"), [
    { kind: "thread", id: "thread-a", patch: { like_count: 2, user_liked: true } },
  ])

  publishContentChange({ kind: "thread", id: "thread-a", patch: { like_count: 3 } })
  publishContentChange({ kind: "thread", id: "thread-a", removed: true })

  assert.deepEqual(consumeContentChanges("thread"), [
    { kind: "thread", id: "thread-a", removed: true },
  ])
})
