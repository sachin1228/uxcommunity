import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryStorage } from "./memory-storage";
import { createOfflineChatController } from "./sync";
import type {
  Cursor,
  IncomingMessage,
  LocalMessage,
  OutboxRecord,
  SendOutcome,
  ServerPage,
  SyncEvent,
  SyncTransport,
} from "./types";

type Payload = {
  content: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reactions?: string[];
  created_at?: string;
};

const REF = { kind: "community" as const, id: "c1" };
const KEY = "community:c1";

class FakeTransport implements SyncTransport<Payload> {
  sends: OutboxRecord[] = [];
  pages: ServerPage<Payload>[] = [];
  outcome: (record: OutboxRecord) => SendOutcome<Payload> = (record) => ({
    ok: true,
    duplicate: false,
    message: {
      id: `server-${record.id}`,
      created_at: new Date(1_000).toISOString(),
      user_id: record.userId,
      payload: { content: record.body.content },
      clientNonce: record.id,
    },
  });
  fetched: Array<{ after?: Cursor | null; before?: Cursor | null }> = [];
  gate: Promise<void> | null = null;

  async send(record: OutboxRecord): Promise<SendOutcome<Payload>> {
    this.sends.push(record);
    if (this.gate) await this.gate;
    return this.outcome(record);
  }

  async fetchPage(
    _ref: { kind: "community" | "dm"; id: string },
    cursors: { after?: Cursor | null; before?: Cursor | null },
  ): Promise<ServerPage<Payload>> {
    this.fetched.push(cursors);
    return this.pages.shift() ?? { messages: [], hasMore: false };
  }
}

function setup(options: { autoDrain?: boolean; storage?: ReturnType<typeof createMemoryStorage<Payload>> } = {}) {
  let clock = 1_000;
  const storage = options.storage ?? createMemoryStorage<Payload>();
  const transport = new FakeTransport();
  const events: SyncEvent<Payload>[] = [];
  const controller = createOfflineChatController<Payload>({
    storage,
    transport,
    now: () => clock,
    random: () => 0.5,
    autoDrain: options.autoDrain ?? false,
  });
  controller.subscribe((event) => events.push(event));
  return {
    storage,
    transport,
    controller,
    events,
    storeMessages: () => storage.loadMessages("user-1", KEY, 120),
    advance(ms: number) {
      clock += ms;
    },
    now: () => clock,
  };
}

async function enqueue(
  controller: ReturnType<typeof setup>["controller"],
  content = "hello",
  created_at = new Date(1_000).toISOString(),
) {
  return controller.enqueueText({
    ref: REF,
    content,
    replyToId: null,
    replyToContent: null,
    mentionUserIds: [],
    optimisticPayload: { content, created_at },
  });
}

test("enqueue persists the optimistic message and its queue record together", async () => {
  const h = setup();
  await h.controller.activate("user-1");

  const message = await enqueue(h.controller);

  assert.equal(message.status, "queued");
  assert.match(message.id, /^temp-/);
  const stored = await h.storeMessages();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, "queued");
  const pending = await h.controller.pendingRecords(REF);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, message.clientNonce);
  assert.equal(h.transport.sends.length, 0, "enqueue alone must not fabricate a send");
});

test("a successful drain stores exactly one sent row, clears the queue and advances the checkpoint", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  const message = await enqueue(h.controller);

  await h.controller.drainOutbox();

  const stored = await h.storeMessages();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, `server-${message.clientNonce}`);
  assert.equal(stored[0].status, "sent");
  assert.equal((await h.controller.pendingRecords(REF)).length, 0);
  const checkpoint = await h.controller.getCheckpoint(REF);
  assert.equal(checkpoint?.newestId, stored[0].id);
  assert.ok(h.events.some((event) => event.type === "message-sent"));
});

test("pending work survives a process restart and is sent exactly once", async () => {
  const storage = createMemoryStorage<Payload>();
  const first = setup({ storage });
  await first.controller.activate("user-1");
  await enqueue(first.controller, "survives restart");
  first.controller.deactivate();

  const second = setup({ storage });
  await second.controller.activate("user-1");
  await second.controller.drainOutbox();

  assert.equal(second.transport.sends.length, 1);
  const stored = await storage.loadMessages("user-1", KEY, 120);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, "sent");
});

test("a duplicate server response is not a second row", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  const local = await enqueue(h.controller);
  h.transport.outcome = (record) => ({
    ok: true,
    duplicate: true,
    message: {
      id: "server-original",
      created_at: new Date(1_000).toISOString(),
      user_id: record.userId,
      payload: { content: record.body.content },
      clientNonce: record.id,
    },
  });

  await h.controller.drainOutbox();
  await h.controller.drainOutbox();

  const stored = await h.storeMessages();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, "server-original");
  assert.notEqual(stored[0].id, local.id);
});

test("network failure keeps the bubble queued with backoff, then retries it", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await enqueue(h.controller);
  h.transport.outcome = () => ({
    ok: false,
    kind: "retry",
    error: "Network error.",
  });

  await h.controller.drainOutbox();

  const queued = await h.storeMessages();
  assert.equal(queued[0].status, "queued");
  const [record] = await h.controller.pendingRecords(REF);
  assert.equal(record.state, "queued");
  assert.equal(record.attempts, 1);
  assert.ok(record.nextAttemptAt > h.now());

  // Before the backoff deadline the record is not re-sent.
  h.transport.outcome = (r) => ({
    ok: true,
    duplicate: false,
    message: {
      id: `server-${r.id}`,
      created_at: new Date(2_000).toISOString(),
      user_id: r.userId,
      payload: { content: r.body.content },
      clientNonce: r.id,
    },
  });
  await h.controller.drainOutbox();
  assert.equal(h.transport.sends.length, 1);

  h.advance(record.nextAttemptAt - h.now());
  await h.controller.drainOutbox();
  assert.equal(h.transport.sends.length, 2);
  assert.equal((await h.storeMessages())[0].status, "sent");
});

test("a permanent rejection becomes failed with a manual retry, never a silent drop", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await enqueue(h.controller);
  h.transport.outcome = () => ({
    ok: false,
    kind: "permanent",
    error: "You can't send messages to this member.",
  });

  await h.controller.drainOutbox();

  const failed = await h.storeMessages();
  assert.equal(failed[0].status, "failed");
  assert.equal(failed[0].failureReason, "You can't send messages to this member.");
  assert.equal((await h.controller.pendingRecords(REF)).length, 1);
  assert.ok(h.events.some((event) => event.type === "message-failed"));

  h.transport.outcome = (r) => ({
    ok: true,
    duplicate: false,
    message: {
      id: `server-${r.id}`,
      created_at: new Date(3_000).toISOString(),
      user_id: r.userId,
      payload: { content: r.body.content },
      clientNonce: r.id,
    },
  });
  await h.controller.retry(failed[0].clientNonce!);
  assert.equal((await h.storeMessages())[0].status, "sent");
});

test("auth failure pauses without spending the attempt budget", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await enqueue(h.controller);
  h.transport.outcome = () => ({ ok: false, kind: "auth", error: "Session expired" });

  await h.controller.drainOutbox();

  const [record] = await h.controller.pendingRecords(REF);
  assert.equal(record.state, "queued");
  assert.equal(record.attempts, 1);
  assert.ok(record.nextAttemptAt >= h.now());
});

test("a second drain joins the first — one record, one request", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await enqueue(h.controller);

  let release: () => void = () => {};
  h.transport.gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = h.controller.drainOutbox();
  const second = h.controller.drainOutbox();
  release();
  await Promise.all([first, second]);

  assert.equal(h.transport.sends.length, 1);
});

test("account isolation: another account cannot drain or see the queue", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await enqueue(h.controller);

  await h.controller.activate("user-2");
  assert.equal((await h.controller.pendingRecords()).length, 0);
  await h.controller.drainOutbox();
  assert.equal(h.transport.sends.length, 0);

  const old = await h.storage.loadMessages("user-1", KEY, 120);
  assert.equal(old.length, 1);
  assert.equal(old[0].status, "queued");
  assert.equal((await h.storage.loadMessages("user-2", KEY, 120)).length, 0);
});

test("realtime echo before the HTTP response converges to one row", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  const optimistic = await enqueue(h.controller);
  const echo: IncomingMessage<Payload> = {
    id: "server-echo",
    created_at: new Date(1_000).toISOString(),
    user_id: "user-1",
    payload: { content: "hello" },
    clientNonce: optimistic.clientNonce!,
  };
  await h.controller.applyRealtime(REF, echo);
  assert.equal((await h.storeMessages()).length, 1);

  h.transport.outcome = () => ({ ok: true, duplicate: false, message: echo });
  await h.controller.drainOutbox();
  const stored = await h.storeMessages();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, "server-echo");
});

test("HTTP response before the realtime event also converges to one row", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  const optimistic = await enqueue(h.controller);
  const server: IncomingMessage<Payload> = {
    id: "server-first",
    created_at: new Date(1_000).toISOString(),
    user_id: "user-1",
    payload: { content: "hello" },
    clientNonce: optimistic.clientNonce!,
  };
  h.transport.outcome = () => ({ ok: true, duplicate: false, message: server });
  await h.controller.drainOutbox();
  await h.controller.applyRealtime(REF, server);
  assert.equal((await h.storeMessages()).length, 1);
});

test("catch-up walks compound cursors, dedupes and stops on a short page", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  const pageSize = 2;
  const controller = createOfflineChatController<Payload>({
    storage: h.storage,
    transport: h.transport,
    now: h.now,
    random: () => 0.5,
    pageSize,
    autoDrain: false,
  });
  await controller.activate("user-1");

  h.transport.pages = [
    {
      messages: [
        { id: "m1", created_at: new Date(1_000).toISOString(), user_id: "u2", payload: { content: "one" } },
        { id: "m2", created_at: new Date(2_000).toISOString(), user_id: "u2", payload: { content: "two" } },
      ],
      hasMore: true,
    },
    {
      messages: [
        { id: "m2", created_at: new Date(2_000).toISOString(), user_id: "u2", payload: { content: "two" } },
        { id: "m3", created_at: new Date(3_000).toISOString(), user_id: "u2", payload: { content: "three" } },
      ],
      hasMore: false,
    },
  ];

  await controller.catchUp(REF);

  const stored = await h.storeMessages();
  assert.deepEqual(stored.map((row) => row.id), ["m1", "m2", "m3"]);
  assert.equal(h.transport.fetched.length, 2);
  const checkpoint = await controller.getCheckpoint(REF);
  assert.equal(checkpoint?.newestId, "m3");
  assert.equal(checkpoint?.oldestId, "m1");
});

test("a checkpoint never advances when the page could not be committed", async () => {
  const storage = createMemoryStorage<Payload>();
  const transport = new FakeTransport();
  transport.pages = [
    {
      messages: [
        { id: "m1", created_at: new Date(1_000).toISOString(), user_id: "u2", payload: { content: "one" } },
      ],
      hasMore: false,
    },
  ];
  const controller = createOfflineChatController<Payload>({
    storage: {
      ...storage,
      async saveMessages() {
        throw new Error("disk full");
      },
    },
    transport,
    now: () => 1_000,
    autoDrain: false,
  });
  await controller.activate("user-1");

  await assert.rejects(controller.catchUp(REF), /disk full/);
  assert.equal(await controller.getCheckpoint(REF), null);
});

test("revalidation applies an edit that happened while offline", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await h.controller.saveFetchedPage(
    REF,
    {
      messages: [
        { id: "m1", created_at: new Date(1_000).toISOString(), user_id: "u2", payload: { content: "before" } },
      ],
    },
    { authoritative: true },
  );

  h.transport.pages = [
    {
      messages: [
        {
          id: "m1",
          created_at: new Date(1_000).toISOString(),
          user_id: "u2",
          payload: { content: "edited", edited_at: new Date(2_000).toISOString() },
        },
      ],
      hasMore: false,
    },
  ];
  await h.controller.revalidateWindow(REF);

  const stored = await h.storeMessages();
  assert.equal(stored[0].payload.content, "edited");
  assert.equal(stored[0].payload.edited_at, new Date(2_000).toISOString());
});

test("realtime patches apply edits, deletions and reactions", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await h.controller.applyRealtime(REF, {
    id: "m1",
    created_at: new Date(1_000).toISOString(),
    user_id: "u2",
    payload: { content: "hello" },
  });

  await h.controller.patchRealtime(REF, "m1", { content: "edited" });
  await h.controller.patchRealtime(REF, "m1", { reactions: ["👍"] });
  await h.controller.patchRealtime(REF, "m1", {
    content: "",
    edited_at: null,
    deleted_at: new Date(3_000).toISOString(),
  });

  const [row] = await h.storeMessages();
  assert.equal(row.payload.content, "");
  assert.deepEqual(row.payload.reactions, ["👍"]);
  assert.ok(row.payload.deleted_at);
});

test("stale async work from the previous account cannot write after a switch", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await enqueue(h.controller);
  let release: () => void = () => {};
  h.transport.gate = new Promise((resolve) => {
    release = resolve;
  });
  const drain = h.controller.drainOutbox();
  // Switch accounts while the request is in flight.
  await h.controller.activate("user-2");
  release();
  await drain;

  const userTwoRows = await h.storage.loadMessages("user-2", KEY, 120);
  assert.equal(userTwoRows.length, 0);
  const [record] = await h.storage.listOutbox("user-1");
  assert.ok(record, "the original account's queue is untouched");
});

test("hydrate returns only the signed-in account's window", async () => {
  const h = setup();
  await h.controller.activate("user-1");
  await h.controller.applyRealtime(REF, {
    id: "m1",
    created_at: new Date(1_000).toISOString(),
    user_id: "u2",
    payload: { content: "hi" },
  });
  assert.equal((await h.controller.hydrate(REF)).length, 1);

  await h.controller.activate("user-2");
  assert.equal((await h.controller.hydrate(REF)).length, 0);
});

test("an inactive controller refuses to enqueue", async () => {
  const h = setup();
  await assert.rejects(
    enqueue(h.controller),
    /not active for an account/,
  );
});
