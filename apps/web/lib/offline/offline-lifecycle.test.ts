import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOfflineChatController,
  type OutboxRecord,
  type SendOutcome,
  type ServerPage,
  type SyncTransport,
} from "@uxcommunity/offline-chat";
import { createIndexedDbStorage, clearOfflineAccount } from "./indexed-db";
import { createWebTransport } from "./transport";

// Same payload shape the web store is typed with (`Record<string, unknown>`);
// narrowing it here would make `createIndexedDbStorage()`'s storage parameter
// invariant and unrelated to the controller's.
type Payload = Record<string, unknown>;
const REF = { kind: "dm" as const, id: "conversation-1" };

function userId() {
  return `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

class CountingTransport implements SyncTransport<Payload> {
  sends: OutboxRecord[] = [];
  async send(record: OutboxRecord): Promise<SendOutcome<Payload>> {
    this.sends.push(record);
    return {
      ok: true,
      duplicate: false,
      message: {
        id: `server-${record.id}`,
        created_at: new Date(1_000).toISOString(),
        user_id: record.userId,
        payload: { content: record.body.content },
        clientNonce: record.id,
      },
    };
  }
  async fetchPage(): Promise<ServerPage<Payload>> {
    return { messages: [], hasMore: false };
  }
}

test("outbox survives a controller restart over IndexedDB and sends exactly once", async () => {
  const user = userId();
  const storage = createIndexedDbStorage();
  const first = createOfflineChatController<Payload>({
    storage,
    transport: new CountingTransport(),
    now: () => 1_000,
    autoDrain: false,
  });
  await first.activate(user);
  const optimistic = await first.enqueueText({
    ref: REF,
    content: "survives restart",
    replyToId: null,
    replyToContent: null,
    mentionUserIds: [],
    optimisticPayload: { content: "survives restart" },
  });
  first.deactivate();

  const transport = new CountingTransport();
  const second = createOfflineChatController<Payload>({
    storage: createIndexedDbStorage(),
    transport,
    now: () => 2_000,
    autoDrain: false,
  });
  await second.activate(user);
  assert.equal((await second.hydrate(REF))[0].id, optimistic.id);

  await second.drainOutbox();
  await second.drainOutbox();

  assert.equal(transport.sends.length, 1);
  assert.equal(transport.sends[0].id, optimistic.clientNonce);
  const stored = await storage.loadMessages(user, "dm:conversation-1");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, "sent");
  assert.equal((await second.pendingRecords(REF)).length, 0);
  await clearOfflineAccount(user);
});

test("the web transport sends a UUID nonce and treats a 200 replay as success", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(
      JSON.stringify({
        duplicate: true,
        message: {
          id: "server-original",
          created_at: "2026-01-01T00:00:00.000Z",
          user_id: "user-1",
          content: "hi",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const transport = createWebTransport();
    const record: OutboxRecord = {
      id: "33333333-3333-4333-8333-333333333333",
      userId: "user-1",
      conversationKey: "community:c1",
      ref: { kind: "community", id: "c1" },
      state: "sending",
      attempts: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
      nextAttemptAt: 1_000,
      leaseUntil: 31_000,
      lastError: null,
      body: {
        content: "hi",
        replyToId: null,
        replyToContent: null,
        mentionUserIds: ["u2"],
      },
    };

    const outcome = await transport.send(record);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.duplicate, true);
    assert.equal(outcome.message.id, "server-original");
    assert.equal(calls[0].url, "/api/communities/c1/messages");
    assert.deepEqual(calls[0].body, {
      content: "hi",
      reply_to_id: null,
      reply_to_content: null,
      mentions: [{ user_id: "u2" }],
      client_nonce: "33333333-3333-4333-8333-333333333333",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a 403 is permanent, a 503 retries, and a 429 carries Retry-After", async () => {
  const originalFetch = globalThis.fetch;
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      })) as typeof fetch;

  const record: OutboxRecord = {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "user-1",
    conversationKey: "dm:c1",
    ref: { kind: "dm", id: "c1" },
    state: "sending",
    attempts: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    nextAttemptAt: 1_000,
    leaseUntil: 31_000,
    lastError: null,
    body: { content: "hi", replyToId: null, replyToContent: null, mentionUserIds: [] },
  };

  try {
    globalThis.fetch = respond(403, { error: "You can't send messages to this member." });
    const blocked = await createWebTransport().send(record);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.kind, "permanent");
      assert.match(blocked.error, /can't send/);
    }

    globalThis.fetch = respond(503, { error: "down" });
    const unavailable = await createWebTransport().send(record);
    assert.equal(unavailable.ok, false);
    if (!unavailable.ok) assert.equal(unavailable.kind, "retry");

    globalThis.fetch = respond(429, { error: "Too many messages." }, { "Retry-After": "7" });
    const limited = await createWebTransport().send(record);
    assert.equal(limited.ok, false);
    if (!limited.ok) {
      assert.equal(limited.kind, "rate-limit");
      assert.equal(limited.retryAfterMs, 7_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
