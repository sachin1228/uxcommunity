/**
 * SQLite adapter for the shared offline-chat contract.
 *
 * ACCOUNT ISOLATION
 *   One database file per member (`offline-chat-v1-<userId>.db`), the mobile
 *   counterpart of the web's per-account IndexedDB. Rows also carry `user_id`
 *   and every write checks it, so a stale screen from a previous account
 *   cannot persist into the new one.
 *
 * TRANSACTIONS
 *   enqueue / complete / claim are real SQLite transactions. That is what makes
 *   "optimistic bubble + queue record" survive a process kill as one unit, and
 *   what stops two workers from leasing the same record.
 *
 * FAILURE POSTURE
 *   `init` throws on an incompatible `user_version` or an unreadable schema.
 *   The engine treats that as "offline disabled" and the online chat continues
 *   to work; nothing is deleted implicitly.
 */

import type {
  CompleteOutboxInput,
  ConversationRecord,
  LocalMessage,
  OfflineChatStorage,
  OutboxRecord,
  SyncCheckpoint,
} from "../../../packages/offline-chat/src";
import {
  claimRecord,
  compareMessages,
  isClaimable,
  sortOutbox,
  STORAGE_WINDOW_SIZE,
} from "../../../packages/offline-chat/src";
import type { SqlDriver, SqlValue } from "./sql-driver";

const SCHEMA_VERSION = 1;
/** Keep at least what the controller stores; see STORAGE_WINDOW_SIZE. */
const WINDOW_LIMIT = STORAGE_WINDOW_SIZE;

type Payload = Record<string, unknown>;

interface MessageRow {
  conversation_key: string;
  id: string;
  user_id: string;
  author_id: string;
  created_at: string;
  status: string;
  client_nonce: string | null;
  failure_reason: string | null;
  payload: string;
  updated_at: number;
}

interface CheckpointRow {
  conversation_key: string;
  user_id: string;
  newest_ts: string | null;
  newest_id: string | null;
  oldest_ts: string | null;
  oldest_id: string | null;
  updated_at: number;
}

interface ConversationRow {
  conversation_key: string;
  user_id: string;
  kind: string;
  ref_id: string;
  last_message_at: string | null;
  unread_count: number;
  payload: string;
  updated_at: number;
}

interface OutboxRow {
  id: string;
  user_id: string;
  conversation_key: string;
  ref_kind: string;
  ref_id: string;
  state: string;
  attempts: number;
  created_at: number;
  updated_at: number;
  next_attempt_at: number;
  lease_until: number;
  last_error: string | null;
  body: string;
}

export function offlineDatabaseName(userId: string): string {
  // UUIDs are filename-safe; encode defensively for any future id shape.
  return `offline-chat-v1-${encodeURIComponent(userId)}.db`;
}

function parsePayload<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function toLocalMessage(row: MessageRow): LocalMessage<Payload> | null {
  if (!row?.id || !row?.created_at) return null;
  const payload = parsePayload<Payload>(row.payload, {});
  return {
    id: row.id,
    userId: row.user_id,
    conversationKey: row.conversation_key,
    created_at: row.created_at,
    user_id: row.author_id,
    status:
      row.status === "queued" || row.status === "sending" || row.status === "failed"
        ? row.status
        : "sent",
    clientNonce: row.client_nonce,
    failureReason: row.failure_reason,
    payload,
    updatedAt: row.updated_at,
  };
}

function toOutboxRecord(row: OutboxRow): OutboxRecord | null {
  if (!row?.id) return null;
  return {
    id: row.id,
    userId: row.user_id,
    conversationKey: row.conversation_key,
    ref:
      row.ref_kind === "dm"
        ? { kind: "dm", id: row.ref_id }
        : { kind: "community", id: row.ref_id },
    state:
      row.state === "sending" || row.state === "failed" ? row.state : "queued",
    attempts: Number(row.attempts) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    nextAttemptAt: Number(row.next_attempt_at) || 0,
    leaseUntil: Number(row.lease_until) || 0,
    lastError: row.last_error,
    body: parsePayload(row.body, {
      content: "",
      replyToId: null,
      replyToContent: null,
      mentionUserIds: [],
    }),
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  conversation_key TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  client_nonce TEXT,
  failure_reason TEXT,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_key, id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_key, created_at, id);
CREATE INDEX IF NOT EXISTS idx_messages_nonce
  ON messages (conversation_key, client_nonce);

CREATE TABLE IF NOT EXISTS checkpoints (
  conversation_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  newest_ts TEXT,
  newest_id TEXT,
  oldest_ts TEXT,
  oldest_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  conversation_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  last_message_at TEXT,
  unread_count INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  last_error TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_due
  ON outbox (user_id, state, next_attempt_at);
`;

export function createSqliteStorage(driver: SqlDriver): OfflineChatStorage<Payload> {
  let activeUserId: string | null = null;
  let initialized = false;

  function owner(): string {
    if (!activeUserId) throw new Error("Offline storage is not active for an account.");
    return activeUserId;
  }

  return {
    async init(userId) {
      activeUserId = userId;
      if (initialized) return;
      await driver.exec("PRAGMA journal_mode = WAL;");
      await driver.exec(SCHEMA_SQL);
      const versionRows = await driver.all<{ user_version: number }>("PRAGMA user_version;");
      const version = Number(versionRows[0]?.user_version ?? 0);
      if (version > SCHEMA_VERSION) {
        throw new Error(
          `Offline chat storage is newer (v${version}) than this build (v${SCHEMA_VERSION}).`,
        );
      }
      if (version < SCHEMA_VERSION) {
        // v0 is "no tables"; SCHEMA_SQL just created them. Future local
        // migrations branch on `version` here and are only advanced after the
        // migration completes.
        await driver.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      }
      initialized = true;
    },

    async loadMessages(userId, conversationKey, limit = 120) {
      const rows = await driver.all<MessageRow>(
        `SELECT * FROM messages
          WHERE user_id = ? AND conversation_key = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
        [userId, conversationKey, limit],
      );
      return rows
        .map(toLocalMessage)
        .filter((row): row is LocalMessage<Payload> => row !== null)
        .reverse();
    },

    async loadMessagesBefore(userId, conversationKey, before, limit) {
      // Same total order as `compareMessages` (created_at, then id); ISO
      // timestamps compare chronologically as text. The row at the cursor is
      // excluded so a page can never repeat the oldest row on screen.
      const rows = await driver.all<MessageRow>(
        `SELECT * FROM messages
          WHERE user_id = ? AND conversation_key = ?
            AND (created_at < ? OR (created_at = ? AND id < ?))
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
        [userId, conversationKey, before.ts, before.ts, before.id, limit],
      );
      return rows
        .map(toLocalMessage)
        .filter((row): row is LocalMessage<Payload> => row !== null)
        .reverse();
    },

    async saveMessages(userId, conversationKey, rows) {
      await driver.transaction(async () => {
        // Replace only confirmed rows; queued/sending/failed rows are owned by
        // the outbox and must survive a stale UI snapshot.
        await driver.run(
          `DELETE FROM messages
            WHERE user_id = ? AND conversation_key = ? AND status = 'sent'`,
          [userId, conversationKey],
        );
        for (const row of rows) {
          if (row.userId !== userId || row.status !== "sent") continue;
          await upsertMessage(driver, row);
        }
        await driver.run(
          `DELETE FROM messages
            WHERE conversation_key = ? AND status = 'sent' AND id IN (
              SELECT id FROM messages
               WHERE conversation_key = ? AND status = 'sent'
               ORDER BY created_at DESC, id DESC
               LIMIT -1 OFFSET ?
            )`,
          [conversationKey, conversationKey, WINDOW_LIMIT],
        );
      });
    },

    async updateMessageStatus(userId, conversationKey, messageId, status, failureReason = null) {
      await driver.run(
        `UPDATE messages
            SET status = ?, failure_reason = ?, updated_at = ?
          WHERE conversation_key = ? AND id = ? AND user_id = ?`,
        [status, failureReason, Date.now(), conversationKey, messageId, userId],
      );
    },

    async getCheckpoint(userId, conversationKey) {
      const rows = await driver.all<CheckpointRow>(
        `SELECT * FROM checkpoints WHERE conversation_key = ? AND user_id = ?`,
        [conversationKey, userId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        conversationKey: row.conversation_key,
        newestTs: row.newest_ts,
        newestId: row.newest_id,
        oldestTs: row.oldest_ts,
        oldestId: row.oldest_id,
        updatedAt: Number(row.updated_at),
      };
    },

    async saveCheckpoint(checkpoint) {
      await driver.run(
        `INSERT OR REPLACE INTO checkpoints
          (conversation_key, user_id, newest_ts, newest_id, oldest_ts, oldest_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpoint.conversationKey,
          checkpoint.userId,
          checkpoint.newestTs,
          checkpoint.newestId,
          checkpoint.oldestTs,
          checkpoint.oldestId,
          checkpoint.updatedAt,
        ],
      );
    },

    async listConversations(userId) {
      const rows = await driver.all<ConversationRow>(
        `SELECT * FROM conversations WHERE user_id = ?`,
        [userId],
      );
      return rows.map(
        (row): ConversationRecord<Payload> => ({
          userId: row.user_id,
          conversationKey: row.conversation_key,
          ref:
            row.kind === "dm"
              ? { kind: "dm", id: row.ref_id }
              : { kind: "community", id: row.ref_id },
          lastMessageAt: row.last_message_at,
          unreadCount: Number(row.unread_count) || 0,
          payload: parsePayload<Payload>(row.payload, {}),
          updatedAt: Number(row.updated_at) || 0,
        }),
      );
    },

    async saveConversations(userId, rows) {
      await driver.transaction(async () => {
        for (const row of rows) {
          if (row.userId !== userId) continue;
          await driver.run(
            `INSERT OR REPLACE INTO conversations
              (conversation_key, user_id, kind, ref_id, last_message_at, unread_count, payload, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.conversationKey,
              row.userId,
              row.ref.kind,
              row.ref.id,
              row.lastMessageAt,
              row.unreadCount,
              JSON.stringify(row.payload),
              row.updatedAt,
            ],
          );
        }
      });
    },

    async enqueueOutbox(record, message) {
      await driver.transaction(async () => {
        if (record.userId !== owner() || message.userId !== owner()) {
          throw new Error("Refusing to queue a message for another account.");
        }
        await upsertMessage(driver, message);
        await upsertOutbox(driver, record);
      });
    },

    async claimOutbox(userId, now, leaseMs, limit) {
      return driver.transaction(async () => {
        const rows = await driver.all<OutboxRow>(
          `SELECT * FROM outbox
            WHERE user_id = ?
              AND state <> 'failed'
              AND ((state = 'queued' AND next_attempt_at <= ?)
                OR (state = 'sending' AND lease_until <= ?))
            ORDER BY created_at ASC, id ASC
            LIMIT ?`,
          [userId, now, now, limit],
        );
        const claimed: OutboxRecord[] = [];
        for (const row of rows) {
          const record = toOutboxRecord(row);
          if (!record || record.userId !== userId || !isClaimable(record, now)) continue;
          const next = claimRecord(record, now, leaseMs);
          await upsertOutbox(driver, next);
          claimed.push(next);
        }
        return claimed;
      });
    },

    async updateOutbox(record) {
      const existing = await driver.all<{ user_id: string }>(
        `SELECT user_id FROM outbox WHERE id = ?`,
        [record.id],
      );
      if (!existing[0] || existing[0].user_id !== record.userId) return;
      await upsertOutbox(driver, record);
    },

    async completeOutbox(input: CompleteOutboxInput<Payload>) {
      await driver.transaction(async () => {
        const key = input.message.conversationKey;
        if (input.message.clientNonce) {
          await driver.run(
            `DELETE FROM messages
              WHERE conversation_key = ? AND user_id = ? AND (id = ? OR client_nonce = ?)`,
            [key, input.userId, input.message.id, input.message.clientNonce],
          );
        } else {
          await driver.run(
            `DELETE FROM messages WHERE conversation_key = ? AND id = ?`,
            [key, input.message.id],
          );
        }
        await upsertMessage(driver, input.message);
        await driver.run(`DELETE FROM outbox WHERE id = ? AND user_id = ?`, [
          input.recordId,
          input.userId,
        ]);
      });
    },

    async listOutbox(userId, conversationKey) {
      const rows = conversationKey
        ? await driver.all<OutboxRow>(
            `SELECT * FROM outbox WHERE user_id = ? AND conversation_key = ?`,
            [userId, conversationKey],
          )
        : await driver.all<OutboxRow>(`SELECT * FROM outbox WHERE user_id = ?`, [userId]);
      return sortOutbox(
        rows
          .map(toOutboxRecord)
          .filter((row): row is OutboxRecord => row !== null && row.userId === userId),
      );
    },

    async clear(userId) {
      if (activeUserId === userId) activeUserId = null;
      await driver.transaction(async () => {
        await driver.run(`DELETE FROM messages WHERE user_id = ?`, [userId]);
        await driver.run(`DELETE FROM checkpoints WHERE user_id = ?`, [userId]);
        await driver.run(`DELETE FROM conversations WHERE user_id = ?`, [userId]);
        await driver.run(`DELETE FROM outbox WHERE user_id = ?`, [userId]);
      });
    },
  };
}

async function upsertMessage(driver: SqlDriver, row: LocalMessage<Payload>): Promise<void> {
  const params: SqlValue[] = [
    row.conversationKey,
    row.id,
    row.userId,
    row.user_id,
    row.created_at,
    row.status,
    row.clientNonce,
    row.failureReason,
    JSON.stringify(row.payload),
    row.updatedAt,
  ];
  await driver.run(
    `INSERT OR REPLACE INTO messages
      (conversation_key, id, user_id, author_id, created_at, status, client_nonce, failure_reason, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params,
  );
}

async function upsertOutbox(driver: SqlDriver, record: OutboxRecord): Promise<void> {
  await driver.run(
    `INSERT OR REPLACE INTO outbox
      (id, user_id, conversation_key, ref_kind, ref_id, state, attempts, created_at, updated_at, next_attempt_at, lease_until, last_error, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.userId,
      record.conversationKey,
      record.ref.kind,
      record.ref.id,
      record.state,
      record.attempts,
      record.createdAt,
      record.updatedAt,
      record.nextAttemptAt,
      record.leaseUntil,
      record.lastError,
      JSON.stringify(record.body),
    ],
  );
}

/** Sort helper exported for tests that assert window ordering. */
export { compareMessages };
