import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue } from "./sql-driver";
import { createSqliteStorage } from "./storage";

type Payload = { content: string };

const REF = { kind: "dm" as const, id: "conversation-1" };
const KEY = "dm:conversation-1";

/**
 * The real schema and every statement run under node:sqlite, while the app
 * uses expo-sqlite. Only the driver differs.
 */
function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(":memory:");
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      db.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async transaction(fn) {
      db.exec("BEGIN");
      try {
        const result = await fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      db.close();
    },
    async deleteDatabase() {
      db.close();
    },
  };
}

function user(id: string) {
  return `user-${id}-${Math.random().toString(36).slice(2, 7)}`;
}

function message(userId: string, id: string, nonce: string, created_at = "2026-01-01T00:00:00.000Z") {
  return {
    id,
    userId,
    conversationKey: KEY,
    created_at,
    user_id: userId,
    status: "queued" as const,
    clientNonce: nonce,
    failureReason: null,
    payload: { content: id } as Payload,
    updatedAt: 1_000,
  };
}

function record(userId: string, nonce: string) {
  return {
    id: nonce,
    userId,
    conversationKey: KEY,
    ref: REF,
    state: "queued" as const,
    attempts: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    nextAttemptAt: 1_000,
    leaseUntil: 0,
    lastError: null,
    body: { content: "hi", replyToId: null, replyToContent: null, mentionUserIds: [] },
  };
}

test("enqueue and claim are transactional leases", async () => {
  const driver = nodeDriver();
  const storage = createSqliteStorage(driver);
  const userId = user("lease");
  await storage.init(userId);

  await storage.enqueueOutbox(
    record(userId, "00000000-0000-4000-8000-000000000001"),
    message(userId, "temp-1", "00000000-0000-4000-8000-000000000001"),
  );
  assert.equal((await storage.loadMessages(userId, KEY)).length, 1);

  const first = await storage.claimOutbox(userId, 1_000, 30_000, 10);
  assert.equal(first.length, 1);
  assert.equal(first[0].state, "sending");
  assert.equal((await storage.claimOutbox(userId, 2_000, 30_000, 10)).length, 0);

  const reclaimed = await storage.claimOutbox(userId, 31_000, 30_000, 10);
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].attempts, 2);
  await driver.close();
});

test("completion replaces the optimistic row and clears the queue", async () => {
  const driver = nodeDriver();
  const storage = createSqliteStorage(driver);
  const userId = user("complete");
  await storage.init(userId);
  const nonce = "00000000-0000-4000-8000-000000000002";
  await storage.enqueueOutbox(record(userId, nonce), message(userId, `temp-${nonce}`, nonce));
  const [claimed] = await storage.claimOutbox(userId, 1_000, 30_000, 10);

  await storage.completeOutbox({
    userId,
    recordId: claimed.id,
    duplicate: false,
    message: {
      ...message(userId, "server-1", nonce),
      status: "sent",
      payload: { content: "hello" },
    },
  });

  const stored = await storage.loadMessages(userId, KEY);
  assert.deepEqual(stored.map((row) => row.id), ["server-1"]);
  assert.equal(stored[0].clientNonce, nonce);
  assert.equal((await storage.listOutbox(userId)).length, 0);
  await driver.close();
});

test("a UI window write keeps local-only rows", async () => {
  const driver = nodeDriver();
  const storage = createSqliteStorage(driver);
  const userId = user("window");
  await storage.init(userId);
  const nonce = "00000000-0000-4000-8000-000000000003";
  await storage.enqueueOutbox(record(userId, nonce), message(userId, `temp-${nonce}`, nonce));

  await storage.saveMessages(userId, KEY, [
    {
      ...message(userId, "server-1", "", "2026-01-02T00:00:00.000Z"),
      status: "sent",
      payload: { content: "server" },
    },
  ]);

  const stored = await storage.loadMessages(userId, KEY);
  assert.deepEqual(stored.map((row) => row.id).sort(), ["server-1", `temp-${nonce}`].sort());
  await driver.close();
});

test("checkpoints, conversations and outbox are account-scoped", async () => {
  const driver = nodeDriver();
  const storage = createSqliteStorage(driver);
  const owner = user("owner");
  const other = user("other");
  await storage.init(owner);

  await storage.saveCheckpoint({
    userId: owner,
    conversationKey: KEY,
    newestTs: "2026-01-01T00:00:00.000Z",
    newestId: "m1",
    oldestTs: null,
    oldestId: null,
    updatedAt: 1,
  });
  await storage.saveConversations(owner, [
    {
      userId: owner,
      conversationKey: KEY,
      ref: REF,
      lastMessageAt: null,
      unreadCount: 2,
      payload: { preview: "hi" },
      updatedAt: 1,
    },
  ]);
  await storage.enqueueOutbox(record(owner, "00000000-0000-4000-8000-000000000004"), message(owner, "temp-4", "00000000-0000-4000-8000-000000000004"));

  assert.equal(await storage.getCheckpoint(other, KEY), null);
  assert.equal((await storage.listConversations(other)).length, 0);
  assert.equal((await storage.listOutbox(other)).length, 0);
  assert.equal((await storage.listConversations(owner))[0].unreadCount, 2);
  await driver.close();
});

test("a foreign queue record is refused", async () => {
  const driver = nodeDriver();
  const storage = createSqliteStorage(driver);
  const owner = user("guard");
  await storage.init(owner);
  await assert.rejects(
    storage.enqueueOutbox(
      record(user("intruder"), "00000000-0000-4000-8000-000000000005"),
      message(user("intruder"), "temp-5", "00000000-0000-4000-8000-000000000005"),
    ),
    /another account/,
  );
  await driver.close();
});
