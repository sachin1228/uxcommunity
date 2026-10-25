/**
 * Message ordering, merging and local-row conversion.
 *
 * The sort is the exact total order the SQL pages use — ascending
 * `(created_at, id)` — so a compound cursor is comparable and a burst of
 * same-millisecond messages can never straddle a page boundary.
 *
 * The merge rule has two modes because catch-up and window revalidation ask
 * different questions:
 *
 *   * `merge` (catch-up): a row we already hold WINS. The page is a snapshot
 *     taken before it returned; letting it overwrite would revert an edit, a
 *     deletion or a reaction that realtime applied while the request was in
 *     flight. Its job is to add ids we do not have.
 *   * `authoritative` (post-reconnect revalidation of the visible window): the
 *     server snapshot wins for rows that are already confirmed, because that is
 *     the only way an edit/delete/reaction that happened while this device was
 *     offline is ever observed. Optimistic (`queued`/`sending`/`failed`) rows
 *     are still preserved — they do not exist on the server yet.
 *
 * Optimistic rows are always matched by their client nonce as well as their
 * id, so an echo that arrives before (or after) its HTTP response can never
 * leave both a temp bubble and its authoritative copy on screen.
 */

import { isOptimisticId } from "./ids";
import type {
  Cursor,
  IncomingMessage,
  LocalMessage,
  LocalMessageStatus,
} from "./types";

export const DEFAULT_WINDOW_SIZE = 120;

interface CursorLike {
  id: string;
  created_at: string;
}

export function compareMessages(a: CursorLike, b: CursorLike): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function cursorOf(message: CursorLike): Cursor {
  return { ts: message.created_at, id: message.id };
}

export function isRealMessage(message: { id: string; status?: LocalMessageStatus }): boolean {
  if (isOptimisticId(message.id)) return false;
  return !message.status || message.status === "sent";
}

export function newestRealMessage<T extends CursorLike & { status?: LocalMessageStatus }>(
  messages: readonly T[],
): T | null {
  let newest: T | null = null;
  for (const message of messages) {
    if (!isRealMessage(message)) continue;
    if (!newest || compareMessages(message, newest) > 0) newest = message;
  }
  return newest;
}

export function oldestRealMessage<T extends CursorLike & { status?: LocalMessageStatus }>(
  messages: readonly T[],
): T | null {
  let oldest: T | null = null;
  for (const message of messages) {
    if (!isRealMessage(message)) continue;
    if (!oldest || compareMessages(message, oldest) < 0) oldest = message;
  }
  return oldest;
}

/** Compare two cursors by the same total order. Null sorts before everything. */
export function compareCursors(a: Cursor | null, b: Cursor | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return compareMessages({ id: a.id, created_at: a.ts }, { id: b.id, created_at: b.ts });
}

export function maxCursor(a: Cursor | null, b: Cursor | null): Cursor | null {
  if (!a) return b;
  if (!b) return a;
  return compareCursors(a, b) >= 0 ? a : b;
}

/** Null means "no constraint", not "older than everything". */
export function minCursor(a: Cursor | null, b: Cursor | null): Cursor | null {
  if (!a) return b;
  if (!b) return a;
  return compareCursors(a, b) <= 0 ? a : b;
}

export interface MergeOptions {
  /**
   * Replace confirmed rows with the fetched copies (post-reconnect window
   * revalidation). Defaults to false — see the module doc.
   */
  authoritative?: boolean;
  /** Keep the newest N rows after merging. 0/undefined = unbounded. */
  limit?: number;
  /** The viewing account (rows added to an empty window need an owner). */
  userId?: string;
  /** The conversation key (rows added to an empty window need one). */
  conversationKey?: string;
}

/**
 * Fold a server page into a locally held window.
 *
 * Returns the SAME array when nothing changed, so a caller can skip a write.
 * The result is deduped by id and sorted by the shared total order; merging the
 * same page twice is therefore a no-op.
 */
export function mergeServerPage<TPayload>(
  current: readonly LocalMessage<TPayload>[],
  incoming: readonly IncomingMessage<TPayload>[],
  options: MergeOptions = {},
): LocalMessage<TPayload>[] {
  if (incoming.length === 0) return current as LocalMessage<TPayload>[];

  const byId = new Map<string, LocalMessage<TPayload>>();
  const nonceToTemp = new Map<string, LocalMessage<TPayload>>();
  for (const row of current) {
    byId.set(row.id, row);
    if (row.clientNonce) nonceToTemp.set(row.clientNonce, row);
  }

  let changed = false;

  for (const serverRow of incoming) {
    if (!serverRow || typeof serverRow.id !== "string") continue;

    const existing =
      byId.get(serverRow.id) ??
      (serverRow.clientNonce ? nonceToTemp.get(serverRow.clientNonce) : undefined) ??
      null;

    const next: LocalMessage<TPayload> = existing
      ? {
          ...existing,
          id: serverRow.id,
          created_at: serverRow.created_at,
          user_id: serverRow.user_id,
          clientNonce: serverRow.clientNonce ?? existing.clientNonce ?? null,
        }
      : {
          id: serverRow.id,
          userId: options.userId ?? current[0]?.userId ?? "",
          conversationKey:
            options.conversationKey ?? current[0]?.conversationKey ?? "",
          created_at: serverRow.created_at,
          user_id: serverRow.user_id,
          status: "sent",
          clientNonce: serverRow.clientNonce ?? null,
          failureReason: null,
          payload: serverRow.payload,
          updatedAt: Date.now(),
        };

    if (existing) {
      const optimistic = existing.status !== "sent" || isOptimisticId(existing.id);
      const replaceRow =
        optimistic || options.authoritative === true || existing.id !== serverRow.id;
      if (!replaceRow) continue; // existing wins — catch-up only fills gaps
      if (replaceRow) {
        next.payload = serverRow.payload;
        next.status = "sent";
        next.failureReason = null;
      }
      next.updatedAt = Math.max(existing.updatedAt, next.updatedAt);
      if (existing.id !== serverRow.id) {
        // The optimistic bubble is replaced by the authoritative row, not kept
        // alongside it — this is what prevents a duplicate after an echo lands
        // before (or after) the HTTP response.
        byId.delete(existing.id);
        nonceToTemp.delete(existing.clientNonce ?? "");
      }
      byId.set(serverRow.id, next);
      changed = true;
      continue;
    }

    byId.set(serverRow.id, next);
    changed = true;
  }

  if (!changed) return current as LocalMessage<TPayload>[];

  let merged = Array.from(byId.values()).sort(compareMessages);
  if (options.limit && options.limit > 0 && merged.length > options.limit) {
    merged = merged.slice(-options.limit);
  }
  return merged;
}

/** Build the local row for a server message. */
export function toLocalMessage<TPayload>(
  args: {
    userId: string;
    conversationKey: string;
    status?: LocalMessageStatus;
    clientNonce?: string | null;
    failureReason?: string | null;
    updatedAt?: number;
  },
  incoming: IncomingMessage<TPayload>,
): LocalMessage<TPayload> {
  return {
    id: incoming.id,
    userId: args.userId,
    conversationKey: args.conversationKey,
    created_at: incoming.created_at,
    user_id: incoming.user_id,
    status: args.status ?? "sent",
    clientNonce: args.clientNonce ?? incoming.clientNonce ?? null,
    failureReason: args.failureReason ?? null,
    payload: incoming.payload,
    updatedAt: args.updatedAt ?? Date.now(),
  };
}

/**
 * Apply a realtime patch (edit, delete, reaction update) to one row.
 * Returns the same array when the row is unknown or the patch changes nothing.
 */
export function patchLocalMessage<TPayload>(
  current: readonly LocalMessage<TPayload>[],
  messageId: string,
  patch: Partial<TPayload>,
): LocalMessage<TPayload>[] {
  const index = current.findIndex((row) => row.id === messageId);
  if (index === -1) return current as LocalMessage<TPayload>[];
  const row = current[index];
  const next: LocalMessage<TPayload> = {
    ...row,
    payload: { ...(row.payload as object), ...(patch as object) } as TPayload,
    updatedAt: Date.now(),
  };
  const result = current.slice();
  result[index] = next;
  return result;
}

/**
 * Insert-or-replace a realtime message. Realtime rows are authoritative for
 * their own identity, but an older `created_at` than the local copy of the same
 * id is ignored (a replay must be harmless).
 */
export function applyRealtimeMessage<TPayload>(
  current: readonly LocalMessage<TPayload>[],
  incoming: IncomingMessage<TPayload>,
  meta: { userId: string; conversationKey: string },
): LocalMessage<TPayload>[] {
  const existing = current.find((row) => row.id === incoming.id);
  if (existing) {
    if (compareMessages(existing, incoming) > 0) return current as LocalMessage<TPayload>[];
    const next: LocalMessage<TPayload> = {
      ...existing,
      payload: incoming.payload,
      updatedAt: Date.now(),
    };
    const result = current.slice();
    result[current.indexOf(existing)] = next;
    return result;
  }

  const optimistic = incoming.clientNonce
    ? current.find((row) => row.clientNonce === incoming.clientNonce)
    : undefined;
  const row = toLocalMessage<TPayload>(
    {
      userId: meta.userId,
      conversationKey: meta.conversationKey,
      status: "sent",
      clientNonce: incoming.clientNonce ?? null,
    },
    incoming,
  );

  const withoutOptimistic = optimistic
    ? current.filter((candidate) => candidate !== optimistic)
    : current.slice();
  return [...withoutOptimistic, row].sort(compareMessages);
}

/** Rows safe to keep in the local history (optimistic rows are separate). */
export function persistableMessages<TPayload>(
  rows: readonly LocalMessage<TPayload>[],
): LocalMessage<TPayload>[] {
  return rows.filter((row) => row.status === "sent" && !isOptimisticId(row.id));
}
