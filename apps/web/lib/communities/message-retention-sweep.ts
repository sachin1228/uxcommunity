/**
 * The 15-day community chat sweep: hard-deletes chat messages older than the
 * retention window and removes their R2 images.
 *
 * WHY HARD DELETE
 *   The chat is a disappearing chat — the notice at the top of the window
 *   promises "messages disappear after 15 days for everyone", and a soft
 *   delete (deleted_at tombstone, what a moderator removal writes) would keep
 *   both the rows and the promise's letter intact while breaking its spirit:
 *   the window would never actually shrink. So expired rows are removed from
 *   the database outright. Reactions ride along via ON DELETE CASCADE and
 *   replies keep their own row with reply_to_id set to null (the FK's
 *   ON DELETE SET NULL), so nothing else needs cleanup.
 *
 * WHERE IT RUNS
 *   The realtime Worker's cron POSTs /api/internal/community-message-retention
 *   (see apps/realtime/src/retention.ts); this module never runs on a page
 *   render. A run is bounded by a wall-clock budget and deletes oldest-first
 *   in batches, so a big backlog (the first run after deploy) drains over
 *   consecutive runs instead of outpacing the route's patience. Every step is
 *   idempotent: a re-run re-selects whatever is still expired.
 *
 * WHAT IT ANNOUNCES
 *   After deleting, each affected community's room gets one `messages-expired`
 *   event carrying the cutoff, so an open chat prunes its cached copies at
 *   once instead of showing messages that no longer exist (the client handler
 *   lives in useRealtimeChat.ts). Announcements are best-effort and capped:
 *   clients that miss one drop the rows on their next fetch anyway.
 *
 * This module is a PURE orchestrator: the database, R2 and realtime wiring is
 * injected by the caller (see the internal retention route), which keeps the
 * batching/budgeting logic unit-testable without a server environment.
 */

import { chatRetentionCutoffIso } from "./message-retention";

/** One expired message as the sweep needs it: identity, room, and image. */
export interface ExpiredMessageRow {
  id: string;
  community_id: string;
  image_url: string | null;
}

/** The three database operations the sweep performs. */
export interface RetentionStore {
  listExpired(cutoffIso: string, limit: number): Promise<ExpiredMessageRow[]>;
  countExpired(cutoffIso: string): Promise<number>;
  deleteByIds(ids: string[]): Promise<void>;
}

/** The two side effects per batch/community. */
export interface RetentionSideEffects {
  /**
   * Deletes the R2 objects behind these message image URLs. URLs that are not
   * on our bucket are "skipped", and per-key failures are reported — never
   * thrown — so one unreadable key cannot fail a sweep batch.
   */
  deleteImages(urls: string[]): Promise<{
    deleted: number;
    skipped: number;
    failed: Array<{ key: string; error: string }>;
  }>;
  /** Tells one community's room that everything before `cutoffIso` is gone. */
  announceExpired(communityId: string, cutoffIso: string): Promise<void>;
}

export interface RetentionSweepDeps {
  store: RetentionStore;
  effects: RetentionSideEffects;
}

export interface ChatRetentionSweepSummary {
  dryRun: boolean;
  /** ISO cutoff every deletion in this run used. */
  cutoff: string;
  deletedMessages: number;
  deletedImages: number;
  /** Image URLs that are not on our bucket (nothing to delete). */
  skippedImages: number;
  failedImageDeletes: number;
  /** Distinct communities that had at least one message deleted. */
  communities: number;
  announcementsSent: number;
  /** Communities past the per-run announcement cap (they refetch on next open). */
  announcementsSkipped: number;
  batches: number;
  /** False when the time budget stopped the run before history was exhausted. */
  complete: boolean;
  /** Expired rows still in the database when the run stopped early (or, for a dry run, the backlog size). */
  pendingMessages: number | null;
  durationMs: number;
}

export interface ChatRetentionSweepOptions {
  /** Report the backlog without deleting or announcing anything. */
  dryRun?: boolean;
  batchSize?: number;
  timeBudgetMs?: number;
  /** Test seam for the clock. */
  now?: () => number;
}

/**
 * Rows per select/delete round trip. Each batch costs three round trips
 * (select, delete, R2) at a few hundred milliseconds, so 500 keeps a batch
 * near one second of wall clock.
 */
const DEFAULT_BATCH_SIZE = 500;

/**
 * Wall-clock budget for the DELETE loop. The route sits behind a Worker
 * subrequest, and the backlog only has to shrink — not vanish — per run, so
 * the loop checks the clock before every batch and reports `complete: false`
 * when it stops early with the remainder counted.
 */
const DEFAULT_TIME_BUDGET_MS = 24_000;

/**
 * Per-run cap on `messages-expired` announcements. The first sweep can touch
 * every community at once; publishing hundreds of events would dominate the
 * run, and a missed announcement only costs a refetch.
 */
const ANNOUNCE_MAX_COMMUNITIES = 100;

/** Enough failed key detail for an operator to act, without an unbounded log. */
const FAILED_KEY_DETAILS_MAX = 10;

export async function sweepExpiredChatMessages(
  deps: RetentionSweepDeps,
  options: ChatRetentionSweepOptions = {},
): Promise<ChatRetentionSweepSummary> {
  const { store, effects } = deps;
  const now = options.now ?? Date.now;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;

  const startedAt = now();
  const cutoff = chatRetentionCutoffIso(startedAt);
  const deadline = startedAt + timeBudgetMs;

  const summary: ChatRetentionSweepSummary = {
    dryRun: options.dryRun === true,
    cutoff,
    deletedMessages: 0,
    deletedImages: 0,
    skippedImages: 0,
    failedImageDeletes: 0,
    communities: 0,
    announcementsSent: 0,
    announcementsSkipped: 0,
    batches: 0,
    complete: true,
    pendingMessages: null,
    durationMs: 0,
  };

  if (summary.dryRun) {
    summary.pendingMessages = await store.countExpired(cutoff);
    summary.durationMs = now() - startedAt;
    return summary;
  }

  const affectedCommunities = new Set<string>();

  for (;;) {
    if (now() >= deadline) {
      summary.complete = false;
      break;
    }

    const rows = await store.listExpired(cutoff, batchSize);
    if (!rows.length) break;

    // Delete the rows first, then their images: an R2 failure is retried by
    // the admin orphan audit, while an image deleted before its row would be
    // a live message pointing at a 404 until the next batch succeeds.
    await store.deleteByIds(rows.map((row) => row.id));
    summary.batches += 1;
    summary.deletedMessages += rows.length;

    const imageUrls = rows
      .map((row) => row.image_url)
      .filter((url): url is string => typeof url === "string" && url.length > 0);
    if (imageUrls.length) {
      const outcome = await effects.deleteImages(imageUrls);
      summary.deletedImages += outcome.deleted;
      summary.skippedImages += outcome.skipped;
      summary.failedImageDeletes += outcome.failed.length;
      for (const failure of outcome.failed.slice(0, FAILED_KEY_DETAILS_MAX)) {
        console.error("[retention] image delete failed", failure);
      }
    }

    for (const row of rows) affectedCommunities.add(row.community_id);
  }

  summary.communities = affectedCommunities.size;

  if (!summary.complete) {
    summary.pendingMessages = await store.countExpired(cutoff);
  }

  const announceTargets = [...affectedCommunities].slice(0, ANNOUNCE_MAX_COMMUNITIES);
  summary.announcementsSkipped = affectedCommunities.size - announceTargets.length;
  for (const communityId of announceTargets) {
    try {
      await effects.announceExpired(communityId, cutoff);
      summary.announcementsSent += 1;
    } catch (error) {
      // An announcement is a courtesy to open tabs; deletions stand either way.
      console.error("[retention] announce failed", { communityId, error });
    }
  }

  summary.durationMs = now() - startedAt;
  return summary;
}
