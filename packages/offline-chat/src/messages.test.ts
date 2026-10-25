import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRealtimeMessage,
  compareMessages,
  mergeServerPage,
  newestRealMessage,
  oldestRealMessage,
  patchLocalMessage,
  persistableMessages,
  toLocalMessage,
} from "./messages";
import type { IncomingMessage, LocalMessage } from "./types";

type Payload = { content: string; edited_at?: string | null; reactions?: string[] };

function local(
  id: string,
  created_at: string,
  overrides: Partial<LocalMessage<Payload>> = {},
): LocalMessage<Payload> {
  return {
    id,
    userId: "user-1",
    conversationKey: "community:c1",
    created_at,
    user_id: "user-1",
    status: "sent",
    clientNonce: null,
    failureReason: null,
    payload: { content: id },
    updatedAt: 1,
    ...overrides,
  };
}

function incoming(
  id: string,
  created_at: string,
  content = id,
  clientNonce: string | null = null,
): IncomingMessage<Payload> {
  return { id, created_at, user_id: "user-1", payload: { content }, clientNonce };
}

test("sorts by timestamp then id — the compound cursor order", () => {
  const rows = [local("b", "2026-01-01T00:00:00.000Z"), local("a", "2026-01-01T00:00:00.000Z")];
  rows.sort(compareMessages);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
});

test("newest/oldest ignore optimistic and local-only rows", () => {
  const rows = [
    local("a", "2026-01-01T00:00:00.000Z"),
    local("temp-1", "2026-01-02T00:00:00.000Z", { status: "queued", clientNonce: "1" }),
    local("b", "2026-01-03T00:00:00.000Z"),
  ];
  assert.equal(newestRealMessage(rows)?.id, "b");
  assert.equal(oldestRealMessage(rows)?.id, "a");
  assert.deepEqual(persistableMessages(rows).map((row) => row.id), ["a", "b"]);
});

test("catch-up merge only adds missing ids and keeps the local copy", () => {
  const current = [local("a", "2026-01-01T00:00:00.000Z", { payload: { content: "edited locally" } })];
  const merged = mergeServerPage(current, [
    incoming("a", "2026-01-01T00:00:00.000Z", "stale server copy"),
    incoming("b", "2026-01-02T00:00:00.000Z"),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].payload.content, "edited locally");
  assert.equal(merged[1].id, "b");
  assert.equal(merged[1].userId, "user-1", "new rows inherit the viewer from the window");
});

test("authoritative revalidation replaces confirmed rows (edits/deletes become visible)", () => {
  const current = [local("a", "2026-01-01T00:00:00.000Z", { payload: { content: "old" } })];
  const merged = mergeServerPage(
    current,
    [incoming("a", "2026-01-01T00:00:00.000Z", "edited while offline")],
    { authoritative: true },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].payload.content, "edited while offline");
});

test("an echo confirms its optimistic row by nonce — never two bubbles", () => {
  const optimistic = local("temp-nonce-1", "2026-01-01T00:00:00.000Z", {
    status: "sending",
    clientNonce: "nonce-1",
  });
  const merged = mergeServerPage([optimistic], [incoming("server-1", "2026-01-01T00:00:00.000Z", "hi", "nonce-1")]);
  assert.deepEqual(merged.map((row) => row.id), ["server-1"]);
  assert.equal(merged[0].status, "sent");
  assert.equal(merged[0].clientNonce, "nonce-1");
});

test("merge is idempotent: replaying a page changes nothing", () => {
  const page = [incoming("a", "2026-01-01T00:00:00.000Z")];
  const first = mergeServerPage([], page);
  const second = mergeServerPage(first, page);
  assert.equal(second, first);
});

test("out-of-order pages are sorted and bounded", () => {
  const merged = mergeServerPage(
    [],
    [
      incoming("c", "2026-01-03T00:00:00.000Z"),
      incoming("a", "2026-01-01T00:00:00.000Z"),
      incoming("b", "2026-01-02T00:00:00.000Z"),
    ],
    { limit: 2 },
  );
  assert.deepEqual(merged.map((row) => row.id), ["b", "c"]);
});

test("realtime insert replaces an existing row and ignores stale replays", () => {
  const current = [local("a", "2026-01-02T00:00:00.000Z", { payload: { content: "current" } })];
  const updated = applyRealtimeMessage(
    current,
    incoming("a", "2026-01-02T00:00:00.000Z", "reacted"),
    { userId: "user-1", conversationKey: "community:c1" },
  );
  assert.equal(updated[0].payload.content, "reacted");
  assert.equal(updated.length, 1);

  const stale = applyRealtimeMessage(
    updated,
    incoming("a", "2026-01-01T00:00:00.000Z", "older"),
    { userId: "user-1", conversationKey: "community:c1" },
  );
  assert.equal(stale, updated);
});

test("realtime patch applies edits, deletes and reactions by id", () => {
  const current = [local("a", "2026-01-01T00:00:00.000Z", { payload: { content: "hi" } })];
  const patched = patchLocalMessage(current, "a", { content: "edited", reactions: ["👍"] });
  assert.equal(patched[0].payload.content, "edited");
  assert.deepEqual(patched[0].payload.reactions, ["👍"]);
  assert.equal(patchLocalMessage(current, "missing", { content: "x" }), current);
});

test("toLocalMessage preserves the server identity and nonce", () => {
  const row = toLocalMessage<Payload>(
    { userId: "user-1", conversationKey: "dm:c1", status: "sent" },
    incoming("m1", "2026-01-01T00:00:00.000Z", "hey", "nonce-9"),
  );
  assert.equal(row.id, "m1");
  assert.equal(row.clientNonce, "nonce-9");
  assert.equal(row.conversationKey, "dm:c1");
});
