/**
 * In-memory reference adapter. It exists so the sync/outbox rules can be
 * exercised under `node:test` without a DOM or a native SQLite module; the real
 * IndexedDB and expo-sqlite adapters implement the same contract.
 */

import { isClaimable, claimRecord, sortOutbox } from "./outbox";
import { compareMessages } from "./messages";
import type { OfflineChatStorage, CompleteOutboxInput } from "./storage";
import type {
  ConversationRecord,
  LocalMessage,
  OutboxRecord,
  SyncCheckpoint,
} from "./types";

interface Account<TPayload> {
  messages: Map<string, LocalMessage<TPayload>[]>;
  checkpoints: Map<string, SyncCheckpoint>;
  conversations: ConversationRecord<TPayload>[];
  outbox: Map<string, OutboxRecord>;
}

export function createMemoryStorage<
  TPayload = Record<string, unknown>,
>(): OfflineChatStorage<TPayload> & {
  /** Test seam: inspect without going through a read method. */
  snapshot(userId: string): {
    messages: LocalMessage<TPayload>[];
    outbox: OutboxRecord[];
    checkpoint: SyncCheckpoint | null;
  };
} {
  const accounts = new Map<string, Account<TPayload>>();

  function account(userId: string): Account<TPayload> {
    let existing = accounts.get(userId);
    if (!existing) {
      existing = {
        messages: new Map(),
        checkpoints: new Map(),
        conversations: [],
        outbox: new Map(),
      };
      accounts.set(userId, existing);
    }
    return existing;
  }

  function window(
    store: Account<TPayload>,
    userId: string,
    key: string,
    limit = 120,
  ): LocalMessage<TPayload>[] {
    const rows = store.messages.get(key) ?? [];
    return rows.filter((row) => row.userId === userId).slice(-limit);
  }

  return {
    async init() {
      // Nothing to open.
    },

    async loadMessages(userId, conversationKey, limit = 120) {
      return window(account(userId), userId, conversationKey, limit);
    },

    async saveMessages(userId, conversationKey, rows) {
      const store = account(userId);
      // Replace the confirmed window but keep local-only rows: a UI snapshot
      // that has not observed a confirmation yet must never erase the queued
      // bubble (or the row completeOutbox just wrote).
      const pending = (store.messages.get(conversationKey) ?? []).filter(
        (row) => row.userId === userId && row.status !== "sent",
      );
      store.messages.set(
        conversationKey,
        [...pending, ...rows]
          .filter((row) => row.userId === userId)
          .filter(
            (row, index, all) =>
              all.findIndex(
                (candidate) =>
                  candidate.id === row.id ||
                  (row.clientNonce !== null && candidate.clientNonce === row.clientNonce),
              ) === index,
          )
          .sort(compareMessages)
          .slice(-200),
      );
    },

    async updateMessageStatus(userId, conversationKey, messageId, status, failureReason = null) {
      const store = account(userId);
      const rows = store.messages.get(conversationKey) ?? [];
      store.messages.set(
        conversationKey,
        rows.map((row) =>
          row.id === messageId && row.userId === userId
            ? { ...row, status, failureReason, updatedAt: Date.now() }
            : row,
        ),
      );
    },

    async getCheckpoint(userId, conversationKey) {
      return account(userId).checkpoints.get(conversationKey) ?? null;
    },

    async saveCheckpoint(checkpoint) {
      account(checkpoint.userId).checkpoints.set(checkpoint.conversationKey, { ...checkpoint });
    },

    async listConversations(userId) {
      return account(userId).conversations.filter((row) => row.userId === userId);
    },

    async saveConversations(userId, rows) {
      const store = account(userId);
      const byKey = new Map(store.conversations.filter((row) => row.userId !== userId).map((row) => [row.conversationKey, row]));
      for (const row of rows) {
        if (row.userId !== userId) continue;
        byKey.set(row.conversationKey, { ...row });
      }
      store.conversations = [...byKey.values()];
    },

    async enqueueOutbox(record, message) {
      const store = account(record.userId);
      const rows = (store.messages.get(record.conversationKey) ?? []).filter(
        (row) => row.id !== message.id,
      );
      store.messages.set(
        record.conversationKey,
        [...rows, message].sort(compareMessages),
      );
      store.outbox.set(record.id, { ...record });
    },

    async claimOutbox(userId, now, leaseMs, limit) {
      const store = account(userId);
      const claimed: OutboxRecord[] = [];
      for (const record of sortOutbox([...store.outbox.values()])) {
        if (claimed.length >= limit) break;
        if (record.userId !== userId) continue;
        if (!isClaimable(record, now)) continue;
        const next = claimRecord(record, now, leaseMs);
        store.outbox.set(record.id, next);
        claimed.push(next);
      }
      return claimed;
    },

    async updateOutbox(record) {
      const store = account(record.userId);
      if (!store.outbox.has(record.id)) return;
      store.outbox.set(record.id, { ...record });
    },

    async completeOutbox(input: CompleteOutboxInput<TPayload>) {
      const store = account(input.userId);
      const key = input.message.conversationKey;
      const rows = store.messages.get(key) ?? [];
      const withoutLocal = rows.filter(
        (row) =>
          row.id !== input.message.id &&
          !(input.message.clientNonce && row.clientNonce === input.message.clientNonce),
      );
      store.messages.set(
        key,
        [...withoutLocal, input.message].sort(compareMessages).slice(-200),
      );
      store.outbox.delete(input.recordId);
    },

    async listOutbox(userId, conversationKey) {
      return sortOutbox(
        [...account(userId).outbox.values()].filter(
          (record) =>
            record.userId === userId &&
            (conversationKey === undefined || record.conversationKey === conversationKey),
        ),
      );
    },

    async clear(userId) {
      accounts.delete(userId);
    },

    snapshot(userId) {
      const store = account(userId);
      return {
        messages: [...store.messages.values()].flat(),
        outbox: [...store.outbox.values()],
        checkpoint: [...store.checkpoints.values()][0] ?? null,
      };
    },
  };
}
