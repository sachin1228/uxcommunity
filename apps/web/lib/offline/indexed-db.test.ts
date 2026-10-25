import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chatKey } from "@uxcommunity/offline-chat";
import { createIndexedDbStorage, clearOfflineAccount } from "./indexed-db";

type Payload = { content: string };

const REF = { kind: "dm" as const, id: "conversation-1" };
const KEY = chatKey(REF);

function user(id: string) {
  return `test-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

test("enqueue writes the message and queue record atomically", async () => {
  const storage = createIndexedDbStorage();
  const userId = user("enqueue");
  await storage.init(userId);

  await storage.enqueueOutbox(record(userId, "00000000-0000-4000-8000-000000000001"), message(userId, "temp-1", "00000000-0000-4000-8000-000000000001"));

  const messages = await storage.loadMessages(userId, KEY);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, "queued");
  assert.equal((await storage.listOutbox(userId)).length, 1);
  await clearOfflineAccount(userId);
});

test("claim leases a record and an expired lease is reclaimable", async () => {
  const storage = createIndexedDbStorage();
  const userId = user("lease");
  await storage.init(userId);
  await storage.enqueueOutbox(record(userId, "00000000-0000-4000-8000-000000000002"), message(userId, "temp-2", "00000000-0000-4000-8000-000000000002"));

  const first = await storage.claimOutbox(userId, 1_000, 30_000, 10);
  assert.equal(first.length, 1);
  assert.equal(first[0].state, "sending");
  assert.equal(first[0].attempts, 1);
  assert.equal((await storage.claimOutbox(userId, 2_000, 30_000, 10)).length, 0);

  const reclaimed = await storage.claimOutbox(userId, 31_001, 30_000, 10);
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0].attempts, 2);
  await clearOfflineAccount(userId);
});

test("complete replaces the optimistic row, deletes the queue record and keeps the nonce", async () => {
  const storage = createIndexedDbStorage();
  const userId = user("complete");
  await storage.init(userId);
  const nonce = "00000000-0000-4000-8000-000000000003";
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
  assert.equal(stored[0].status, "sent");
  assert.equal(stored[0].clientNonce, nonce);
  assert.equal((await storage.listOutbox(userId)).length, 0);
  await clearOfflineAccount(userId);
});

test("saving a window never erases a queued row", async () => {
  const storage = createIndexedDbStorage();
  const userId = user("window");
  await storage.init(userId);
  const nonce = "00000000-0000-4000-8000-000000000004";
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
  await clearOfflineAccount(userId);
});

test("checkpoints and conversation rows are account-scoped", async () => {
  const storage = createIndexedDbStorage();
  const first = user("account-a");
  const second = user("account-b");
  await storage.init(first);
  await storage.saveCheckpoint({
    userId: first,
    conversationKey: KEY,
    newestTs: "2026-01-01T00:00:00.000Z",
    newestId: "m1",
    oldestTs: "2026-01-01T00:00:00.000Z",
    oldestId: "m1",
    updatedAt: 1,
  });
  await storage.saveConversations(first, [
    {
      userId: first,
      conversationKey: KEY,
      ref: REF,
      lastMessageAt: null,
      unreadCount: 0,
      payload: { preview: "hello" },
      updatedAt: 1,
    },
  ]);

  await storage.init(second);
  assert.equal(await storage.getCheckpoint(second, KEY), null);
  assert.equal((await storage.listConversations(second)).length, 0);
  assert.equal((await storage.listOutbox(second)).length, 0);

  await storage.init(first);
  assert.equal((await storage.getCheckpoint(first, KEY))?.newestId, "m1");
  assert.equal((await storage.listConversations(first)).length, 1);
  await clearOfflineAccount(first);
  await clearOfflineAccount(second);
});

test("a write from the wrong account is ignored", async () => {
  const storage = createIndexedDbStorage();
  const first = user("owner");
  await storage.init(first);
  await storage.saveConversations(first, [
    {
      userId: user("intruder"),
      conversationKey: KEY,
      ref: REF,
      lastMessageAt: null,
      unreadCount: 0,
      payload: {},
      updatedAt: 1,
    },
  ]);
  assert.equal((await storage.listConversations(first)).length, 0);
  await clearOfflineAccount(first);
});
