/**
 * The data contract shared by the web and mobile offline stores.
 *
 * Every record is scoped by `userId`. The stores additionally isolate accounts
 * physically (one IndexedDB database per member on web, one `user_id` column
 * with an active-user guard on mobile), but the domain layer repeats the check
 * before every write: a stale screen from the previous account must never be
 * able to persist into the new one.
 */

export type ChatKind = "community" | "dm";

/** A conversation addressed the same way on both platforms. */
export interface ChatRef {
  kind: ChatKind;
  /** Community id or DM conversation id. */
  id: string;
}

export function chatKey(ref: ChatRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseChatKey(key: string): ChatRef {
  const separator = key.indexOf(":");
  if (separator <= 0) throw new Error(`Invalid chat key: ${key}`);
  const kind = key.slice(0, separator);
  if (kind !== "community" && kind !== "dm") {
    throw new Error(`Invalid chat kind: ${kind}`);
  }
  return { kind, id: key.slice(separator + 1) };
}

/** Delivery state a bubble renders. `queued` only exists locally. */
export type LocalMessageStatus = "queued" | "sending" | "sent" | "failed";

/**
 * One message as the UI sees it.
 *
 * `payload` is the full row the existing components already render (users,
 * reactions, reply preview, mentions, deleted_at, …). Keeping it opaque means
 * this package never has to know when the chat UI grows a field; only the
 * identity, ordering and status columns are interpreted here.
 */
export interface LocalMessage<TPayload = Record<string, unknown>> {
  /** Server id, or `temp-<nonce>` while the row is only local. */
  id: string;
  userId: string;
  conversationKey: string;
  created_at: string;
  user_id: string;
  status: LocalMessageStatus;
  /** Stable per-logical-send idempotency key (UUID), null for received rows. */
  clientNonce: string | null;
  /** Why a row is `failed` (already user-safe, never a raw server body). */
  failureReason: string | null;
  payload: TPayload;
  /** Local mutation time, used for last-write-wins on mutable rows. */
  updatedAt: number;
}

/** A server row as returned by the existing message APIs. */
export interface IncomingMessage<TPayload = Record<string, unknown>> {
  id: string;
  created_at: string;
  user_id: string;
  payload: TPayload;
  /**
   * Carried on the optimistic row and on a duplicate send response so a late
   * response can find the bubble it confirms. Optional on received rows.
   */
  clientNonce?: string | null;
}

export type OutboxState = "queued" | "sending" | "failed";

/**
 * One durable outgoing text message.
 *
 * The record is the retry unit: it is written in the SAME transaction as the
 * optimistic message, survives a process kill, and every attempt reuses `id`
 * (the client nonce) as the server-side idempotency key.
 */
export interface OutboxRecord {
  /** Stable idempotency key. Also the optimistic bubble's `temp-<id>` suffix. */
  id: string;
  userId: string;
  conversationKey: string;
  ref: ChatRef;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms. The record is not claimable before this. */
  nextAttemptAt: number;
  /**
   * Epoch ms until which a worker owns the record. A `sending` record whose
   * lease expired was interrupted (tab closed, OS killed the app) and is
   * claimable again; a live lease is never double-sent.
   */
  leaseUntil: number;
  /** User-safe failure text for the retry affordance. */
  lastError: string | null;
  /** The exact POST body, minus platform-specific upload fields. */
  body: OutboxBody;
}

export interface OutboxBody {
  content: string;
  replyToId: string | null;
  /** Content-anchored reply (thread/showcase/resource/event card). */
  replyToContent: { id: string; kind: string } | null;
  mentionUserIds: string[];
}

/** Conversation-list row cache (sidebar / DM list). */
export interface ConversationRecord<TPayload = Record<string, unknown>> {
  userId: string;
  conversationKey: string;
  ref: ChatRef;
  /** Server-provided sort time — the preview message's created_at. */
  lastMessageAt: string | null;
  unreadCount: number;
  payload: TPayload;
  updatedAt: number;
}

/**
 * How far this device has synchronized one conversation.
 *
 * `newest*` is the cursor catch-up asks `?after=` for; it may only move
 * forward after the rows up to it are committed locally. `oldest*` is the
 * pagination floor for `?before=`.
 */
export interface SyncCheckpoint {
  userId: string;
  conversationKey: string;
  newestTs: string | null;
  newestId: string | null;
  oldestTs: string | null;
  oldestId: string | null;
  updatedAt: number;
}

export interface Cursor {
  ts: string;
  id: string;
}

/** One page of server rows. */
export interface ServerPage<TPayload = Record<string, unknown>> {
  messages: IncomingMessage<TPayload>[];
  /**
   * True when the server may have more rows in this direction. Defaults to
   * `messages.length >= pageSize` when omitted by a transport.
   */
  hasMore?: boolean;
}

/** What a send attempt resolved to. */
export type SendOutcome<TPayload = Record<string, unknown>> =
  | {
      ok: true;
      /** True when the server recognised the nonce and returned the original. */
      duplicate: boolean;
      message: IncomingMessage<TPayload>;
      /**
       * Response fields the app needs beyond the message — today the DM
       * request lifecycle (`request_state` / `requested_by`). Kept opaque so
       * this package does not model product rules it does not own.
       */
      meta?: Record<string, unknown>;
    }
  | {
      ok: false;
      /** Classified by ./backoff — decides whether the record retries. */
      kind: import("./backoff").FailureKind;
      error: string;
      /** Server guidance for `rate-limit`, in milliseconds. */
      retryAfterMs?: number;
    };

/**
 * A conversation's reconciliation surface. Each app implements it against the
 * endpoints and auth model it already has (browser cookies / Expo session).
 */
export interface SyncTransport<TPayload = Record<string, unknown>> {
  /** POST one queued message. MUST forward `record.id` as `client_nonce`. */
  send(record: OutboxRecord, signal?: AbortSignal): Promise<SendOutcome<TPayload>>;
  /**
   * GET one page. `after: null` means the newest page; `after` means
   * everything newer than that cursor. `before` pages older history.
   */
  fetchPage(
    ref: ChatRef,
    cursors: { after?: Cursor | null; before?: Cursor | null },
    signal?: AbortSignal,
  ): Promise<ServerPage<TPayload>>;
}

/** Events the UI subscribes to; all are conversation-scoped. */
export type SyncEvent<TPayload = Record<string, unknown>> =
  | { type: "messages"; conversationKey: string; messages: LocalMessage<TPayload>[] }
  | {
      type: "message-sent";
      conversationKey: string;
      clientNonce: string;
      message: IncomingMessage<TPayload>;
      meta?: Record<string, unknown>;
    }
  | {
      type: "message-failed";
      conversationKey: string;
      clientNonce: string;
      error: string;
    }
  | {
      type: "outbox";
      conversationKey: string;
      /** Number of records still awaiting transmission for this conversation. */
      pending: number;
    }
  | { type: "connectivity"; online: boolean };
