/**
 * IndexedDB adapter for the shared offline-chat contract.
 *
 * ACCOUNT ISOLATION
 *   One database per signed-in member (`uxcommunity-chat-v1-<userId>`), not a
 *   `userId` column in a shared database. A stale render or a bug in an app
 *   query then physically cannot read another account's rows, and sign-out can
 *   leave the account's own queue intact without exposing it to whoever signs
 *   in next. The engine also checks ownership on every call.
 *
 * WHY RAW IDB
 *   Dexie would simplify the schema, but the whole read path is three
 *   indexed reads and one bounded window write; adding a ~25 KB dependency (and
 *   its own migration story) for that is not worth it. All schema knowledge is
 *   in this file, and the shared package's in-memory adapter proves the engine
 *   against the same contract.
 *
 * FAILURE POSTURE
 *   Every operation rejects on failure. The app's activation wrapper catches a
 *   failure and disables the offline layer — an unavailable/blocked database
 *   must never stop the online chat from working. `deleteAccountDatabase` is
 *   the explicit recovery for an incompatible schema; it is never called
 *   silently.
 */

import type {
  CompleteOutboxInput,
  ConversationRecord,
  LocalMessage,
  OfflineChatStorage,
  OutboxRecord,
  SyncCheckpoint,
} from "@uxcommunity/offline-chat";
import {
  claimRecord,
  compareMessages,
  isClaimable,
  sortOutbox,
  STORAGE_WINDOW_SIZE,
} from "@uxcommunity/offline-chat";

const DB_PREFIX = "uxcommunity-chat-v1-";
const SCHEMA_VERSION = 1;
/** Keep at least what the controller stores; see STORAGE_WINDOW_SIZE. */
const WINDOW_LIMIT = STORAGE_WINDOW_SIZE;

type Payload = Record<string, unknown>;

interface MessageRow extends LocalMessage<Payload> {}
interface CheckpointRow extends SyncCheckpoint {}
interface ConversationRow extends ConversationRecord<Payload> {}
interface OutboxRow extends OutboxRecord {}

function databaseName(userId: string): string {
  return `${DB_PREFIX}${encodeURIComponent(userId)}`;
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

const openDatabases = new Map<string, Promise<IDBDatabase>>();

function openDatabase(userId: string): Promise<IDBDatabase> {
  const cached = openDatabases.get(userId);
  if (cached) return cached;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(databaseName(userId), SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("messages")) {
        const store = db.createObjectStore("messages", {
          keyPath: ["conversationKey", "id"],
        });
        store.createIndex("by_conversation", "conversationKey", { unique: false });
      }
      if (!db.objectStoreNames.contains("checkpoints")) {
        db.createObjectStore("checkpoints", { keyPath: "conversationKey" });
      }
      if (!db.objectStoreNames.contains("conversations")) {
        db.createObjectStore("conversations", { keyPath: "conversationKey" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onblocked = () =>
      reject(new Error("Offline database is blocked by another tab."));
    req.onerror = () => reject(req.error ?? new Error("Could not open the offline database."));
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opening a newer schema closes this connection rather than
      // blocking the upgrade forever.
      db.onversionchange = () => {
        db.close();
        openDatabases.delete(userId);
      };
      db.onclose = () => openDatabases.delete(userId);
      resolve(db);
    };
  }).catch((error) => {
    openDatabases.delete(userId);
    throw error;
  });

  openDatabases.set(userId, promise);
  return promise;
}

async function deleteAccountDatabase(userId: string): Promise<void> {
  const cached = openDatabases.get(userId);
  openDatabases.delete(userId);
  if (cached) {
    try {
      (await cached).close();
    } catch {
      // Already closed/blocked.
    }
  }
  if (!isIndexedDbAvailable()) return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(databaseName(userId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Could not delete the offline database."));
    req.onblocked = () => reject(new Error("Offline database delete is blocked by another tab."));
  });
}

async function readConversationMessages(
  store: IDBObjectStore,
  conversationKey: string,
): Promise<MessageRow[]> {
  const index = store.index("by_conversation");
  return (await request(index.getAll(conversationKey))) as MessageRow[];
}

function dedupeRows(rows: readonly MessageRow[]): MessageRow[] {
  const seen = new Set<string>();
  const seenNonces = new Set<string>();
  const result: MessageRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    if (row.clientNonce && seenNonces.has(row.clientNonce)) continue;
    seen.add(row.id);
    if (row.clientNonce) seenNonces.add(row.clientNonce);
    result.push(row);
  }
  return result;
}

export function createIndexedDbStorage(): OfflineChatStorage<Payload> {
  let activeUserId: string | null = null;

  async function db(): Promise<IDBDatabase> {
    if (!activeUserId) throw new Error("Offline storage is not active for an account.");
    return openDatabase(activeUserId);
  }

  function startsTransaction(
    database: IDBDatabase,
    stores: string | string[],
    mode: IDBTransactionMode,
  ): IDBTransaction {
    return database.transaction(stores, mode);
  }

  return {
    async init(userId) {
      activeUserId = userId;
      // Opening (and running migrations) is the real initialization. A failure
      // is thrown so the caller can disable the offline layer.
      await openDatabase(userId);
      const database = await openDatabase(userId);
      const tx = startsTransaction(database, "meta", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("meta").put({ key: "schema", version: SCHEMA_VERSION, openedAt: Date.now() });
      await done;
    },

    async loadMessages(userId, conversationKey, limit = 120) {
      const database = await db();
      const tx = startsTransaction(database, "messages", "readonly");
      const done = transactionDone(tx);
      const rows = await readConversationMessages(tx.objectStore("messages"), conversationKey);
      await done;
      return rows
        .filter((row) => row.userId === userId)
        .sort(compareMessages)
        .slice(-limit);
    },

    async loadMessagesBefore(userId, conversationKey, before, limit) {
      const database = await db();
      const tx = startsTransaction(database, "messages", "readonly");
      const done = transactionDone(tx);
      const rows = await readConversationMessages(tx.objectStore("messages"), conversationKey);
      await done;
      return rows
        .filter((row) => row.userId === userId)
        .filter((row) => compareMessages(row, { created_at: before.ts, id: before.id }) < 0)
        .sort(compareMessages)
        .slice(-limit);
    },

    async saveMessages(userId, conversationKey, rows) {
      const database = await db();
      const tx = startsTransaction(database, "messages", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("messages");
      const index = store.index("by_conversation");

      const writes = new Promise<void>((resolve, reject) => {
        const scan = index.getAll(conversationKey);
        scan.onerror = () => reject(scan.error ?? new Error("Could not read the message window."));
        scan.onsuccess = () => {
          const existing = scan.result as MessageRow[];
          // Replace only the confirmed window. Local-only rows (queued/
          // sending/failed) belong to the outbox and must survive a stale UI
          // snapshot.
          for (const row of existing) {
            if (row.status === "sent") store.delete([row.conversationKey, row.id]);
          }
          for (const row of rows) {
            if (row.userId !== userId || row.status !== "sent") continue;
            store.put(row);
          }
          resolve();
        };
      });
      await writes;
      await done;

      // Bound the window without ever touching local-only rows.
      const prune = startsTransaction(database, "messages", "readwrite");
      const pruneDone = transactionDone(prune);
      const pruneStore = prune.objectStore("messages");
      const bounded = new Promise<void>((resolve, reject) => {
        const scan = pruneStore.index("by_conversation").getAll(conversationKey);
        scan.onerror = () => reject(scan.error ?? new Error("Could not prune the message window."));
        scan.onsuccess = () => {
          const sent = (scan.result as MessageRow[])
            .filter((row) => row.status === "sent")
            .sort(compareMessages);
          if (sent.length > WINDOW_LIMIT) {
            for (const row of sent.slice(0, sent.length - WINDOW_LIMIT)) {
              pruneStore.delete([row.conversationKey, row.id]);
            }
          }
          resolve();
        };
      });
      await bounded;
      await pruneDone;
    },

    async updateMessageStatus(userId, conversationKey, messageId, status, failureReason = null) {
      const database = await db();
      const tx = startsTransaction(database, "messages", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("messages");
      const write = new Promise<void>((resolve, reject) => {
        const read = store.get([conversationKey, messageId]);
        read.onerror = () => reject(read.error ?? new Error("Could not read the message."));
        read.onsuccess = () => {
          const row = read.result as MessageRow | undefined;
          if (row && row.userId === userId) {
            store.put({ ...row, status, failureReason, updatedAt: Date.now() });
          }
          resolve();
        };
      });
      await write;
      await done;
    },

    async getCheckpoint(userId, conversationKey) {
      const database = await db();
      const tx = startsTransaction(database, "checkpoints", "readonly");
      const done = transactionDone(tx);
      const row = (await request(tx.objectStore("checkpoints").get(conversationKey))) as
        | CheckpointRow
        | undefined;
      await done;
      return row && row.userId === userId ? row : null;
    },

    async saveCheckpoint(checkpoint) {
      const database = await db();
      const tx = startsTransaction(database, "checkpoints", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("checkpoints").put(checkpoint);
      await done;
    },

    async listConversations(userId) {
      const database = await db();
      const tx = startsTransaction(database, "conversations", "readonly");
      const done = transactionDone(tx);
      const rows = (await request(tx.objectStore("conversations").getAll())) as ConversationRow[];
      await done;
      return rows.filter((row) => row.userId === userId);
    },

    async saveConversations(userId, rows) {
      const database = await db();
      const tx = startsTransaction(database, "conversations", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("conversations");
      for (const row of rows) {
        if (row.userId === userId) store.put(row);
      }
      await done;
    },

    async enqueueOutbox(record, message) {
      const database = await db();
      const tx = startsTransaction(database, ["messages", "outbox"], "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("messages").put(message);
      tx.objectStore("outbox").put(record);
      await done;
    },

    async claimOutbox(userId, now, leaseMs, limit) {
      const database = await db();
      const tx = startsTransaction(database, "outbox", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("outbox");
      const claimed: OutboxRecord[] = [];

      // All reads/writes happen inside the request callback so the transaction
      // cannot auto-commit between the scan and the lease writes.
      await new Promise<void>((resolve, reject) => {
        const scan = store.getAll();
        scan.onerror = () => reject(scan.error ?? new Error("Could not read the outbox."));
        scan.onsuccess = () => {
          const due = sortOutbox(
            (scan.result as OutboxRow[]).filter(
              (record) => record.userId === userId && isClaimable(record, now),
            ),
          ).slice(0, limit);
          for (const record of due) {
            const next = claimRecord(record, now, leaseMs);
            store.put(next);
            claimed.push(next);
          }
          resolve();
        };
      });
      await done;
      return claimed;
    },

    async updateOutbox(record) {
      const database = await db();
      const tx = startsTransaction(database, "outbox", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("outbox");
      const write = new Promise<void>((resolve, reject) => {
        const read = store.get(record.id);
        read.onerror = () => reject(read.error ?? new Error("Could not read the queue record."));
        read.onsuccess = () => {
          const existing = read.result as OutboxRow | undefined;
          if (existing && existing.userId === record.userId) store.put(record);
          resolve();
        };
      });
      await write;
      await done;
    },

    async completeOutbox(input: CompleteOutboxInput<Payload>) {
      const database = await db();
      const tx = startsTransaction(database, ["messages", "outbox"], "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("messages");
      const index = store.index("by_conversation");
      const key = input.message.conversationKey;

      await new Promise<void>((resolve, reject) => {
        const scan = index.getAll(key);
        scan.onerror = () => reject(scan.error ?? new Error("Could not read the message window."));
        scan.onsuccess = () => {
          const rows = scan.result as MessageRow[];
          for (const row of rows) {
            const sameNonce =
              input.message.clientNonce !== null &&
              row.clientNonce === input.message.clientNonce;
            if (row.id === input.message.id || sameNonce) {
              store.delete([row.conversationKey, row.id]);
            }
          }
          store.put(input.message);
          tx.objectStore("outbox").delete(input.recordId);
          resolve();
        };
      });
      await done;
    },

    async listOutbox(userId, conversationKey) {
      const database = await db();
      const tx = startsTransaction(database, "outbox", "readonly");
      const done = transactionDone(tx);
      const rows = (await request(tx.objectStore("outbox").getAll())) as OutboxRow[];
      await done;
      return sortOutbox(
        rows.filter(
          (row) =>
            row.userId === userId &&
            (conversationKey === undefined || row.conversationKey === conversationKey),
        ),
      );
    },

    async clear(userId) {
      if (activeUserId === userId) activeUserId = null;
      await deleteAccountDatabase(userId);
    },
  };
}

/** Recovery for an explicit "clear this device's chat data" action. */
export async function clearOfflineAccount(userId: string): Promise<void> {
  await deleteAccountDatabase(userId);
}
