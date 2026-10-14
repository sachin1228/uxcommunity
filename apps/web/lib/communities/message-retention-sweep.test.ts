import assert from "node:assert/strict"
import test from "node:test"

import {
  type ExpiredMessageRow,
  type RetentionSideEffects,
  type RetentionStore,
  sweepExpiredChatMessages,
} from "./message-retention-sweep"
import { CHAT_MESSAGE_RETENTION_DAYS, chatRetentionCutoffIso } from "./message-retention"

const NOW = Date.parse("2026-10-14T12:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

type FakeRow = ExpiredMessageRow & { created_at: string }

function expiredRow(
  id: string,
  ageDays: number,
  opts: { community?: string; image?: string | null } = {},
): FakeRow {
  return {
    id,
    community_id: opts.community ?? "c1",
    image_url: opts.image ?? null,
    created_at: new Date(NOW - ageDays * DAY_MS).toISOString(),
  }
}

function createFakeStore(initial: FakeRow[]) {
  const rows = [...initial]
  const calls = {
    list: 0,
    count: 0,
    deletes: [] as string[][],
  }
  const store: RetentionStore = {
    async listExpired(cutoffIso, limit) {
      calls.list += 1
      const expired = rows
        .filter((row) => row.created_at < cutoffIso)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      return expired
        .slice(0, limit)
        .map(({ id, community_id, image_url }) => ({ id, community_id, image_url }))
    },
    async countExpired(cutoffIso) {
      calls.count += 1
      return rows.filter((row) => row.created_at < cutoffIso).length
    },
    async deleteByIds(ids) {
      calls.deletes.push(ids)
      for (const id of ids) {
        const idx = rows.findIndex((row) => row.id === id)
        if (idx >= 0) rows.splice(idx, 1)
      }
    },
  }
  return { store, calls, rows }
}

function createFakeEffects(overrides: Partial<RetentionSideEffects> = {}) {
  const calls = {
    images: [] as string[][],
    announcements: [] as Array<{ communityId: string; cutoffIso: string }>,
  }
  const effects: RetentionSideEffects = {
    async deleteImages(urls) {
      calls.images.push(urls)
      return { deleted: urls.length, skipped: 0, failed: [] }
    },
    async announceExpired(communityId, cutoffIso) {
      calls.announcements.push({ communityId, cutoffIso })
    },
    ...overrides,
  }
  return { effects, calls }
}

test("deletes expired messages oldest-first in batches and announces each room", async () => {
  const { store, calls, rows } = createFakeStore([
    expiredRow("a1", 20, { community: "c1", image: "https://media.example/a1.webp" }),
    expiredRow("a2", 16, { community: "c1" }),
    expiredRow("a3", 30, { community: "c2", image: "https://media.example/a3.webp" }),
    expiredRow("keep", 1, { community: "c2" }),
  ])
  const { effects, calls: effectCalls } = createFakeEffects()

  const summary = await sweepExpiredChatMessages(
    { store, effects },
    { batchSize: 2, now: () => NOW },
  )

  assert.equal(summary.complete, true)
  assert.equal(summary.batches, 2)
  assert.equal(summary.deletedMessages, 3)
  assert.equal(summary.deletedImages, 2)
  assert.equal(summary.communities, 2)
  assert.equal(summary.pendingMessages, null)
  assert.deepEqual(rows.map((row) => row.id), ["keep"], "recent message must survive")

  // Oldest first: 30-day message leads the first batch.
  assert.deepEqual(calls.deletes[0], ["a3", "a1"])
  assert.deepEqual(calls.deletes[1], ["a2"])

  // Images travel one batch at a time, and only rows that had one.
  assert.deepEqual(effectCalls.images, [
    ["https://media.example/a3.webp", "https://media.example/a1.webp"],
  ])
  assert.deepEqual(
    effectCalls.announcements.map((entry) => entry.communityId).sort(),
    ["c1", "c2"],
  )
  assert.equal(effectCalls.announcements[0].cutoffIso, chatRetentionCutoffIso(NOW))

  // A second run right after the first has nothing left to do.
  const again = await sweepExpiredChatMessages({ store, effects }, { now: () => NOW })
  assert.equal(again.deletedMessages, 0)
  assert.equal(again.batches, 0)
  assert.equal(again.complete, true)
  assert.equal(again.announcementsSent, 0)
})

test("the cutoff sits exactly CHAT_MESSAGE_RETENTION_DAYS behind the run", async () => {
  const { store } = createFakeStore([])
  const { effects } = createFakeEffects()

  const summary = await sweepExpiredChatMessages({ store, effects }, { now: () => NOW })

  assert.equal(CHAT_MESSAGE_RETENTION_DAYS, 15)
  assert.equal(summary.cutoff, "2026-09-29T12:00:00.000Z")
})

test("dry run reports the backlog without deleting or announcing", async () => {
  const { store, calls, rows } = createFakeStore([
    expiredRow("a1", 20),
    expiredRow("a2", 16),
    expiredRow("keep", 2),
  ])
  const { effects, calls: effectCalls } = createFakeEffects()

  const summary = await sweepExpiredChatMessages(
    { store, effects },
    { dryRun: true, now: () => NOW },
  )

  assert.equal(summary.dryRun, true)
  assert.equal(summary.pendingMessages, 2)
  assert.equal(summary.deletedMessages, 0)
  assert.equal(calls.deletes.length, 0)
  assert.equal(effectCalls.images.length, 0)
  assert.equal(effectCalls.announcements.length, 0)
  assert.equal(rows.length, 3, "dry run must not delete rows")
})

test("stops at the time budget and reports the remaining backlog", async () => {
  const { store, calls } = createFakeStore([
    expiredRow("a1", 30),
    expiredRow("a2", 20),
    expiredRow("a3", 16),
  ])
  const { effects } = createFakeEffects()

  // Call order: startedAt, first loop check, second loop check, duration.
  const clock = [NOW, NOW + 100, NOW + 600, NOW + 600]
  let tick = 0
  const now = () => clock[Math.min(tick++, clock.length - 1)]

  const summary = await sweepExpiredChatMessages(
    { store, effects },
    { batchSize: 1, timeBudgetMs: 500, now },
  )

  assert.equal(summary.complete, false)
  assert.equal(summary.batches, 1)
  assert.equal(summary.deletedMessages, 1)
  assert.equal(summary.pendingMessages, 2)
  assert.equal(calls.count, 1, "the remainder is counted once")
})

test("image and announcement failures are reported, not thrown", async () => {
  const { store } = createFakeStore([
    expiredRow("a1", 20, { community: "c1", image: "https://media.example/a1.webp" }),
    expiredRow("a2", 20, { community: "c2" }),
  ])
  const { effects } = createFakeEffects({
    async deleteImages() {
      return {
        deleted: 0,
        skipped: 0,
        failed: [{ key: "chat/c1/a1.webp", error: "AccessDenied" }],
      }
    },
    async announceExpired(communityId) {
      if (communityId === "c2") throw new Error("realtime unreachable")
    },
  })

  const summary = await sweepExpiredChatMessages({ store, effects }, { now: () => NOW })

  assert.equal(summary.failedImageDeletes, 1)
  assert.equal(summary.deletedImages, 0)
  assert.equal(summary.announcementsSent, 1, "the failed announcement is skipped, the other is sent")
  assert.equal(summary.complete, true, "side-effect failures must not fail the sweep")
})

test("caps announcements at the per-run limit", async () => {
  const initial: FakeRow[] = []
  for (let i = 0; i < 101; i += 1) {
    initial.push(expiredRow(`m${i}`, 20, { community: `c${i}` }))
  }
  const { store } = createFakeStore(initial)
  const { effects, calls } = createFakeEffects()

  const summary = await sweepExpiredChatMessages({ store, effects }, { now: () => NOW })

  assert.equal(summary.communities, 101)
  assert.equal(summary.announcementsSent, 100)
  assert.equal(summary.announcementsSkipped, 1)
  assert.equal(calls.announcements.length, 100)
})
