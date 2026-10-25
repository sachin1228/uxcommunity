/**
 * The persistence contract.
 *
 * Both platform adapters must implement the three atomic operations as a single
 * transaction, because the offline guarantee depends on them:
 *
 *   * `enqueueOutbox` writes the optimistic message AND its queue record — a
 *     crash between the two either leaves a bubble that never sends or a queued
 *     record with no bubble;
 *   * `completeOutbox` replaces the optimistic row with the authoritative one
 *     AND deletes the record, so a restart cannot replay a confirmed send;
 *   * `claimOutbox` leases due records, so two tabs/workers cannot both send
 *     the same record. (The server-side nonce makes even a lease violation
 *     harmless; the lease only avoids duplicate traffic.)
 *
 * Every method receives `userId` and must refuse (or ignore) rows that do not
 * belong to it. The engine also checks, but defence in depth is the point of
 * account isolation.
 */

import type {
  ConversationRecord,
  Cursor,
  LocalMessage,
  OutboxRecord,
  SyncCheckpoint,
} from "./types";

/**
 * How many rows one conversation may keep on disk.
 *
 * Deeper than the rendered window (`windowSize`, 120) on purpose: the extra
 * tail is what makes scrolling back instant after a restart — those rows are
 * read from SQLite instead of being requested again. The adapters prune at this
 * bound, so the controller can never store more than they keep.
 */
export const STORAGE_WINDOW_SIZE = 300;

export interface CompleteOutboxInput<TPayload = Record<string, unknown>> {
  userId: string;
  recordId: string;
  /** The authoritative row, already keyed by the real server id. */
  message: LocalMessage<TPayload>;
  /** Outcome was a duplicate replay; no checkpoint advance is needed. */
  duplicate: boolean;
}

export interface OfflineChatStorage<TPayload = Record<string, unknown>> {
  /** Open the store for this account, running local schema migrations. */
  init(userId: string): Promise<void>;
  /** Newest `limit` rows, ascending. */
  loadMessages(
    userId: string,
    conversationKey: string,
    limit?: number,
  ): Promise<LocalMessage<TPayload>[]>;
  /**
   * Up to `limit` rows STRICTLY older than `before`, ascending (oldest first).
   *
   * This is the pagination floor. A conversation whose window is already on
   * disk can answer "load older" without the network; an empty result means the
   * stored window does not reach that far back and the caller should fetch.
   */
  loadMessagesBefore(
    userId: string,
    conversationKey: string,
    before: Cursor,
    limit: number,
  ): Promise<LocalMessage<TPayload>[]>;
  /**
   * Replace the stored window for one conversation. The caller always passes a
   * complete, bounded window (see the controller), so this is an upsert-and-
   * prune operation rather than an append log.
   */
  saveMessages(
    userId: string,
    conversationKey: string,
    rows: readonly LocalMessage<TPayload>[],
  ): Promise<void>;
  updateMessageStatus(
    userId: string,
    conversationKey: string,
    messageId: string,
    status: LocalMessage["status"],
    failureReason?: string | null,
  ): Promise<void>;

  getCheckpoint(userId: string, conversationKey: string): Promise<SyncCheckpoint | null>;
  saveCheckpoint(checkpoint: SyncCheckpoint): Promise<void>;

  listConversations(userId: string): Promise<ConversationRecord<TPayload>[]>;
  saveConversations(
    userId: string,
    rows: readonly ConversationRecord<TPayload>[],
  ): Promise<void>;

  /** Atomic: optimistic message + queue record. */
  enqueueOutbox(record: OutboxRecord, message: LocalMessage<TPayload>): Promise<void>;
  /** Atomic lease claim. Returns only records this caller now owns. */
  claimOutbox(
    userId: string,
    now: number,
    leaseMs: number,
    limit: number,
  ): Promise<OutboxRecord[]>;
  updateOutbox(record: OutboxRecord): Promise<void>;
  /** Atomic: replace the optimistic row, delete the record, advance checkpoint. */
  completeOutbox(input: CompleteOutboxInput<TPayload>): Promise<void>;
  listOutbox(userId: string, conversationKey?: string): Promise<OutboxRecord[]>;

  /** Remove every row for this account (explicit account wipe). */
  clear(userId: string): Promise<void>;
}
