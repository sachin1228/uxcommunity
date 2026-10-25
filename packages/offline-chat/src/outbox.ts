/**
 * Outbox state machine — pure transitions, no storage or timers.
 *
 *   enqueue ──▶ queued ──claim──▶ sending ──accepted──▶ (record deleted)
 *                  ▲                │
 *                  │                ├── retryable failure ──▶ queued (backoff)
 *                  │                ├── auth failure ───────▶ queued (pause)
 *                  │                └── permanent failure ──▶ failed
 *                  └──────── manual retry ◀─────────────────────┘
 *
 * `sending` is durable, not just in-memory: a worker that dies mid-request
 * leaves the record in `sending` with a lease. Once the lease expires another
 * worker reclaims and re-sends it with the SAME idempotency key, so an accepted
 * write whose response was lost is returned by the server instead of duplicated.
 */

import {
  OUTBOX_AUTH_PAUSE_MS,
  OUTBOX_BASE_DELAY_MS,
  OUTBOX_MAX_ATTEMPTS,
  retryDelayMs,
  type FailureKind,
} from "./backoff";
import type { ChatRef, OutboxBody, OutboxRecord } from "./types";
import { chatKey } from "./types";

export interface NewOutboxInput {
  id: string;
  userId: string;
  ref: ChatRef;
  body: OutboxBody;
  now: number;
}

export function createOutboxRecord(input: NewOutboxInput): OutboxRecord {
  return {
    id: input.id,
    userId: input.userId,
    ref: input.ref,
    conversationKey: chatKey(input.ref),
    state: "queued",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
    nextAttemptAt: input.now,
    leaseUntil: 0,
    lastError: null,
    body: input.body,
  };
}

/** A record may be claimed when due, or when its previous worker's lease died. */
export function isClaimable(record: OutboxRecord, now: number): boolean {
  if (record.state === "failed") return false;
  if (record.state === "sending") return record.leaseUntil <= now;
  return record.nextAttemptAt <= now;
}

export function claimRecord(
  record: OutboxRecord,
  now: number,
  leaseMs: number,
): OutboxRecord {
  return {
    ...record,
    state: "sending",
    attempts: record.attempts + 1,
    updatedAt: now,
    leaseUntil: now + leaseMs,
  };
}

/**
 * A retryable failure: schedule the next attempt with jittered backoff. Once
 * the attempt budget is spent the record becomes `failed` so the UI can ask the
 * member to intervene — never a silent drop.
 */
export function scheduleRetry(
  record: OutboxRecord,
  failure: { kind: FailureKind; error: string; retryAfterMs?: number },
  now: number,
  options: { random?: () => number; maxAttempts?: number } = {},
): OutboxRecord {
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  if (failure.kind === "permanent" || record.attempts >= maxAttempts) {
    return {
      ...record,
      state: "failed",
      leaseUntil: 0,
      updatedAt: now,
      lastError: failure.error,
    };
  }

  const delay =
    failure.kind === "rate-limit"
      ? Math.max(failure.retryAfterMs ?? OUTBOX_BASE_DELAY_MS, OUTBOX_BASE_DELAY_MS)
      : failure.kind === "auth"
        ? OUTBOX_AUTH_PAUSE_MS
        : retryDelayMs(record.attempts, options.random);

  return {
    ...record,
    state: "queued",
    leaseUntil: 0,
    updatedAt: now,
    nextAttemptAt: now + delay,
    lastError: failure.error,
  };
}

/** Explicit member retry: due immediately, attempt budget replenished. */
export function markManualRetry(record: OutboxRecord, now: number): OutboxRecord {
  return {
    ...record,
    state: "queued",
    attempts: 0,
    nextAttemptAt: now,
    leaseUntil: 0,
    updatedAt: now,
    lastError: null,
  };
}

export function sortOutbox(records: readonly OutboxRecord[]): OutboxRecord[] {
  return [...records].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
