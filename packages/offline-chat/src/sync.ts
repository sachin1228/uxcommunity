/**
 * The offline chat controller.
 *
 * It sequences the four things an offline-first conversation does, and it is
 * the only place that decides when a checkpoint may move:
 *
 *   hydrate   — read the local window; no network, no waiting.
 *   send      — persist the optimistic message + outbox record atomically, then
 *               drain. A failure never removes the row.
 *   catchUp   — page forward from the checkpoint, committing each page before
 *               advancing the cursor that names it.
 *   revalidate— re-read the visible window after a reconnect so edits,
 *               deletions and reactions that happened while this device was
 *               offline are observed (an `?after=` catch-up cannot see them).
 *
 * Single-flight rules:
 *   * one drain per account at a time (a second trigger joins the first);
 *   * every async continuation re-checks the account generation, so a drain
 *     that survives a logout/account switch cannot write into the new account;
 *   * records are leased by storage (`claimOutbox`), so two tabs cannot both
 *     send the same record — and the server-side nonce makes even that race
 *     harmless.
 */

import { OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS } from "./backoff";
import { newClientNonce, optimisticMessageId } from "./ids";
import {
  applyRealtimeMessage,
  maxCursor,
  mergeServerPage,
  minCursor,
  newestRealMessage,
  patchLocalMessage,
  toLocalMessage,
} from "./messages";
import { createOutboxRecord, markManualRetry, scheduleRetry } from "./outbox";
import type { OfflineChatStorage } from "./storage";
import type {
  ChatRef,
  ConversationRecord,
  Cursor,
  IncomingMessage,
  LocalMessage,
  OutboxBody,
  OutboxRecord,
  ServerPage,
  SyncCheckpoint,
  SyncEvent,
  SyncTransport,
} from "./types";
import { chatKey } from "./types";

export interface OfflineChatControllerOptions<TPayload = Record<string, unknown>> {
  storage: OfflineChatStorage<TPayload>;
  transport: SyncTransport<TPayload>;
  now?: () => number;
  random?: () => number;
  /** Newest rows kept per conversation. Bounded storage, never full history. */
  windowSize?: number;
  /** Page size the existing APIs return; used to detect a short last page. */
  pageSize?: number;
  /** Upper bound on pages one catch-up pass may request. */
  maxCatchUpPages?: number;
  maxAttempts?: number;
  /** Drain immediately after enqueue when online. */
  autoDrain?: boolean;
}

export interface EnqueueTextInput<TPayload> {
  ref: ChatRef;
  content: string;
  replyToId: string | null;
  replyToContent: { id: string; kind: string } | null;
  mentionUserIds: string[];
  /** The bubble the existing UI renders (sender identity, reply preview, …). */
  optimisticPayload: TPayload;
  /**
   * Pre-generated idempotency key. A caller that paints the optimistic bubble
   * synchronously (before IndexedDB's write resolves) supplies it so the bubble
   * id and the queue record are the same send. Omitted = generated here.
   */
  clientNonce?: string;
}

export interface FetchedPageOptions {
  /**
   * Replace confirmed rows with the fetched copies. Use only for a window
   * revalidation / first newest-page load, never for catch-up.
   */
  authoritative?: boolean;
}

export interface OfflineChatController<TPayload = Record<string, unknown>> {
  activate(userId: string): Promise<void>;
  deactivate(): void;
  activeUserId(): string | null;
  subscribe(listener: (event: SyncEvent<TPayload>) => void): () => void;

  hydrate(ref: ChatRef): Promise<LocalMessage<TPayload>[]>;
  /**
   * Persist the window the UI currently holds (sent rows only; queued/failed
   * rows are owned by the outbox). Used after realtime edits/deletes/reactions
   * so a restart replays them. Never deletes queued rows.
   */
  persistWindow(ref: ChatRef, rows: readonly LocalMessage<TPayload>[]): Promise<void>;
  saveFetchedPage(
    ref: ChatRef,
    page: ServerPage<TPayload>,
    options?: FetchedPageOptions,
  ): Promise<LocalMessage<TPayload>[]>;
  saveOlderPage(
    ref: ChatRef,
    page: ServerPage<TPayload>,
  ): Promise<LocalMessage<TPayload>[]>;

  enqueueText(input: EnqueueTextInput<TPayload>): Promise<LocalMessage<TPayload>>;
  drainOutbox(): Promise<void>;
  retry(clientNonce: string): Promise<void>;

  catchUp(ref: ChatRef): Promise<void>;
  revalidateWindow(ref: ChatRef): Promise<void>;
  applyRealtime(ref: ChatRef, incoming: IncomingMessage<TPayload>): Promise<void>;
  patchRealtime(
    ref: ChatRef,
    messageId: string,
    patch: Partial<TPayload>,
  ): Promise<void>;

  getCheckpoint(ref: ChatRef): Promise<SyncCheckpoint | null>;
  pendingRecords(ref?: ChatRef): Promise<OutboxRecord[]>;
  setOnline(online: boolean): void;
  isOnline(): boolean;

  saveConversations(rows: readonly ConversationRecord<TPayload>[]): Promise<void>;
  listConversations(): Promise<ConversationRecord<TPayload>[]>;

  /** Stop workers and wait for any in-flight drain to settle (tests, logout). */
  waitForIdle(): Promise<void>;
}

function emptyCheckpoint(userId: string, conversationKey: string, now: number): SyncCheckpoint {
  return {
    userId,
    conversationKey,
    newestTs: null,
    newestId: null,
    oldestTs: null,
    oldestId: null,
    updatedAt: now,
  };
}

/**
 * The send response returns a bare row (`users: null`, `reply_to: null`) to
 * avoid post-insert reads. Fill those fields from the optimistic row so a
 * restart/hydration still has the sender identity and reply preview instead of
 * rendering "Unknown".
 */
function mergePayload<TPayload>(server: TPayload, local: TPayload | undefined): TPayload {
  if (
    !local ||
    typeof local !== "object" ||
    local === null ||
    typeof server !== "object" ||
    server === null
  ) {
    return server;
  }
  const merged: Record<string, unknown> = { ...(server as Record<string, unknown>) };
  for (const [key, value] of Object.entries(local as Record<string, unknown>)) {
    if (merged[key] === null || merged[key] === undefined) merged[key] = value;
  }
  return merged as TPayload;
}

function checkpointCursor(checkpoint: SyncCheckpoint | null): Cursor | null {
  if (!checkpoint?.newestTs || !checkpoint.newestId) return null;
  return { ts: checkpoint.newestTs, id: checkpoint.newestId };
}

export function createOfflineChatController<TPayload = Record<string, unknown>>(
  options: OfflineChatControllerOptions<TPayload>,
): OfflineChatController<TPayload> {
  const {
    storage,
    transport,
    now = Date.now,
    random = Math.random,
    windowSize = 120,
    pageSize = 50,
    maxCatchUpPages = 10,
    maxAttempts = OUTBOX_MAX_ATTEMPTS,
    autoDrain = true,
  } = options;

  let userId: string | null = null;
  let generation = 0;
  let online = true;
  let pausedUntil = 0;
  let abort: AbortController | null = null;
  let draining: Promise<void> | null = null;
  const listeners = new Set<(event: SyncEvent<TPayload>) => void>();

  function emit(event: SyncEvent<TPayload>): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not interrupt persistence or another tab.
      }
    }
  }

  function activeUser(): string {
    if (!userId) throw new Error("Offline chat is not active for an account.");
    return userId;
  }

  function isCurrent(capturedUser: string, capturedGeneration: number): boolean {
    return userId === capturedUser && generation === capturedGeneration;
  }

  async function advanceCheckpoint(
    owner: string,
    key: string,
    cursors: { newest?: Cursor | null; oldest?: Cursor | null },
  ): Promise<void> {
    const current =
      (await storage.getCheckpoint(owner, key)) ?? emptyCheckpoint(owner, key, now());
    const newest = maxCursor(checkpointCursor(current), cursors.newest ?? null);
    const currentOldest: Cursor | null =
      current.oldestTs && current.oldestId
        ? { ts: current.oldestTs, id: current.oldestId }
        : null;
    const oldest = minCursor(currentOldest, cursors.oldest ?? null);
    const next: SyncCheckpoint = {
      userId: owner,
      conversationKey: key,
      newestTs: newest?.ts ?? null,
      newestId: newest?.id ?? null,
      oldestTs: oldest?.ts ?? null,
      oldestId: oldest?.id ?? null,
      updatedAt: now(),
    };
    if (
      next.newestTs === current.newestTs &&
      next.newestId === current.newestId &&
      next.oldestTs === current.oldestTs &&
      next.oldestId === current.oldestId
    ) {
      return;
    }
    // Called only AFTER the corresponding rows were committed.
    await storage.saveCheckpoint(next);
  }

  async function commitPage(
    ref: ChatRef,
    page: ServerPage<TPayload>,
    authoritative: boolean,
  ): Promise<LocalMessage<TPayload>[]> {
    const owner = activeUser();
    const key = chatKey(ref);
    const local = await storage.loadMessages(owner, key, windowSize);
    const merged = mergeServerPage(local, page.messages, {
      authoritative,
      limit: windowSize,
      userId: owner,
      conversationKey: key,
    });
    if (merged !== local) {
      await storage.saveMessages(owner, key, merged);
    }
    const incomingNewest = page.messages.reduce<Cursor | null>(
      (cursor, row) => maxCursor(cursor, { ts: row.created_at, id: row.id }),
      null,
    );
    const incomingOldest = page.messages.reduce<Cursor | null>(
      (cursor, row) => minCursor(cursor, { ts: row.created_at, id: row.id }),
      null,
    );
    await advanceCheckpoint(owner, key, {
      newest: incomingNewest,
      oldest: incomingOldest,
    });
    emit({ type: "messages", conversationKey: key, messages: merged });
    return merged;
  }

  async function runDrain(): Promise<void> {
    const owner = activeUser();
    const capturedGeneration = generation;
    const controller = new AbortController();
    abort = controller;

    try {
      while (isCurrent(owner, capturedGeneration) && online) {
        const timestamp = now();
        if (pausedUntil > timestamp) break;

        const claimed = await storage.claimOutbox(
          owner,
          timestamp,
          OUTBOX_LEASE_MS,
          10,
        );
        if (claimed.length === 0) break;

        for (const record of claimed) {
          if (!isCurrent(owner, capturedGeneration) || !online) return;

          let outcome;
          try {
            outcome = await transport.send(record, controller.signal);
          } catch (error) {
            if (!isCurrent(owner, capturedGeneration)) return;
            outcome = {
              ok: false as const,
              kind: controller.signal.aborted ? ("permanent" as const) : ("retry" as const),
              error:
                error instanceof Error && error.message
                  ? error.message
                  : "The message could not be sent.",
            };
          }

          if (!isCurrent(owner, capturedGeneration)) return;

          if (outcome.ok) {
            const localWindow = await storage.loadMessages(
              owner,
              record.conversationKey,
              windowSize,
            );
            const optimistic = localWindow.find(
              (row) => row.clientNonce === record.id,
            );
            const confirmed: IncomingMessage<TPayload> = {
              ...outcome.message,
              clientNonce: outcome.message.clientNonce ?? record.id,
              payload: mergePayload(outcome.message.payload, optimistic?.payload),
            };
            const message = toLocalMessage<TPayload>(
              {
                userId: owner,
                conversationKey: record.conversationKey,
                status: "sent",
                clientNonce: record.id,
              },
              confirmed,
            );
            await storage.completeOutbox({
              userId: owner,
              recordId: record.id,
              message,
              duplicate: outcome.duplicate,
            });
            await advanceCheckpoint(owner, record.conversationKey, {
              newest: { ts: message.created_at, id: message.id },
            });
            emit({
              type: "message-sent",
              conversationKey: record.conversationKey,
              clientNonce: record.id,
              message: confirmed,
              meta: outcome.meta,
            });
            const pending = await storage.listOutbox(owner, record.conversationKey);
            emit({
              type: "outbox",
              conversationKey: record.conversationKey,
              pending: pending.length,
            });
            continue;
          }

          const updated = scheduleRetry(record, outcome, now(), {
            random,
            maxAttempts,
          });
          await storage.updateOutbox(updated);
          await storage.updateMessageStatus(
            owner,
            record.conversationKey,
            optimisticMessageId(record.id),
            updated.state === "failed" ? "failed" : "queued",
            updated.state === "failed" ? outcome.error : null,
          );

          if (outcome.kind === "auth") {
            // Session refresh may recover this — pause rather than burn the
            // attempt budget or declare a permission failure.
            pausedUntil = now() + 30_000;
          }

          if (updated.state === "failed") {
            emit({
              type: "message-failed",
              conversationKey: record.conversationKey,
              clientNonce: record.id,
              error: outcome.error,
            });
          }
          const pending = await storage.listOutbox(owner, record.conversationKey);
          emit({
            type: "outbox",
            conversationKey: record.conversationKey,
            pending: pending.length,
          });
        }
      }
    } catch {
      // Storage hiccups must not reject a UI trigger; the next online/focus
      // signal retries the queue.
    } finally {
      if (abort === controller) abort = null;
    }
  }

  const controller: OfflineChatController<TPayload> = {
    async activate(nextUserId) {
      if (userId === nextUserId) return;
      generation += 1;
      abort?.abort();
      abort = null;
      draining = null;
      pausedUntil = 0;
      userId = nextUserId;
      await storage.init(nextUserId);
    },

    deactivate() {
      generation += 1;
      abort?.abort();
      abort = null;
      userId = null;
      draining = null;
      pausedUntil = 0;
    },

    activeUserId: () => userId,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async hydrate(ref) {
      const owner = activeUser();
      return storage.loadMessages(owner, chatKey(ref), windowSize);
    },

    async persistWindow(ref, rows) {
      const owner = activeUser();
      const sent = rows.filter(
        (row) => row.userId === owner && row.status === "sent" && !row.id.startsWith("temp-"),
      );
      if (sent.length === 0) return;
      await storage.saveMessages(owner, chatKey(ref), sent.slice(-windowSize));
    },

    async saveFetchedPage(ref, page, pageOptions) {
      return commitPage(ref, page, pageOptions?.authoritative ?? false);
    },

    async saveOlderPage(ref, page) {
      return commitPage(ref, page, false);
    },

    async enqueueText(input) {
      const owner = activeUser();
      const key = chatKey(input.ref);
      const nonce = input.clientNonce ?? newClientNonce(random);
      const timestamp = now();
      const iso = new Date(timestamp).toISOString();
      const body: OutboxBody = {
        content: input.content,
        replyToId: input.replyToId,
        replyToContent: input.replyToContent,
        mentionUserIds: input.mentionUserIds,
      };
      const message: LocalMessage<TPayload> = {
        id: optimisticMessageId(nonce),
        userId: owner,
        conversationKey: key,
        created_at: iso,
        user_id: owner,
        status: "queued",
        clientNonce: nonce,
        failureReason: null,
        payload: input.optimisticPayload,
        updatedAt: timestamp,
      };
      const record = createOutboxRecord({
        id: nonce,
        userId: owner,
        ref: input.ref,
        body,
        now: timestamp,
      });
      await storage.enqueueOutbox(record, message);
      const window = await storage.loadMessages(owner, key, windowSize);
      emit({ type: "messages", conversationKey: key, messages: window });
      emit({ type: "outbox", conversationKey: key, pending: 1 });
      if (autoDrain && online) void controller.drainOutbox();
      return message;
    },

    async drainOutbox() {
      if (!userId || !online) return;
      if (draining) return draining;
      const run = runDrain().finally(() => {
        if (draining === run) draining = null;
      });
      draining = run;
      return run;
    },

    async retry(clientNonce) {
      const owner = activeUser();
      const records = await storage.listOutbox(owner);
      const record = records.find((row) => row.id === clientNonce);
      if (!record) return;
      const next = markManualRetry(record, now());
      await storage.updateOutbox(next);
      await storage.updateMessageStatus(
        owner,
        record.conversationKey,
        optimisticMessageId(record.id),
        "queued",
        null,
      );
      emit({ type: "outbox", conversationKey: record.conversationKey, pending: records.length });
      await controller.drainOutbox();
    },

    async catchUp(ref) {
      const owner = activeUser();
      const capturedGeneration = generation;
      const key = chatKey(ref);
      const local = await storage.loadMessages(owner, key, windowSize);
      const checkpoint = await storage.getCheckpoint(owner, key);
      const newestLocal = newestRealMessage(local);
      let cursor: Cursor | null =
        checkpointCursor(checkpoint) ??
        (newestLocal ? { ts: newestLocal.created_at, id: newestLocal.id } : null);

      for (let page = 0; page < maxCatchUpPages; page += 1) {
        if (!isCurrent(owner, capturedGeneration)) return;
        const result = await transport.fetchPage(
          ref,
          { after: cursor },
          abort?.signal,
        );
        if (!isCurrent(owner, capturedGeneration)) return;
        if (result.messages.length === 0) break;
        await commitPage(ref, result, false);
        const newest = result.messages[result.messages.length - 1];
        cursor = { ts: newest.created_at, id: newest.id };
        const shortPage =
          result.hasMore === false ||
          result.messages.length < pageSize;
        if (shortPage) break;
      }
    },

    async revalidateWindow(ref) {
      const owner = activeUser();
      const capturedGeneration = generation;
      const result = await transport.fetchPage(
        ref,
        { after: null },
        abort?.signal,
      );
      if (!isCurrent(owner, capturedGeneration)) return;
      if (result.messages.length === 0) return;
      await commitPage(ref, result, true);
    },

    async applyRealtime(ref, incoming) {
      const owner = activeUser();
      const key = chatKey(ref);
      const local = await storage.loadMessages(owner, key, windowSize);
      const merged = applyRealtimeMessage(local, incoming, {
        userId: owner,
        conversationKey: key,
      });
      if (merged === local) return;
      await storage.saveMessages(owner, key, merged.slice(-windowSize));
      await advanceCheckpoint(owner, key, {
        newest: { ts: incoming.created_at, id: incoming.id },
      });
      emit({ type: "messages", conversationKey: key, messages: merged.slice(-windowSize) });
    },

    async patchRealtime(ref, messageId, patch) {
      const owner = activeUser();
      const key = chatKey(ref);
      const local = await storage.loadMessages(owner, key, windowSize);
      const patched = patchLocalMessage(local, messageId, patch);
      if (patched === local) return;
      await storage.saveMessages(owner, key, patched);
      emit({ type: "messages", conversationKey: key, messages: patched });
    },

    async getCheckpoint(ref) {
      return storage.getCheckpoint(activeUser(), chatKey(ref));
    },

    async pendingRecords(ref) {
      return storage.listOutbox(activeUser(), ref ? chatKey(ref) : undefined);
    },

    setOnline(nextOnline) {
      const changed = online !== nextOnline;
      online = nextOnline;
      if (changed) emit({ type: "connectivity", online });
      if (online) {
        pausedUntil = 0;
        void controller.drainOutbox();
      }
    },

    isOnline: () => online,

    async saveConversations(rows) {
      const owner = activeUser();
      await storage.saveConversations(owner, rows);
    },

    async listConversations() {
      return storage.listConversations(activeUser());
    },

    async waitForIdle() {
      const run = draining;
      if (!run) return;
      await run.catch(() => undefined);
    },
  };

  return controller;
}
