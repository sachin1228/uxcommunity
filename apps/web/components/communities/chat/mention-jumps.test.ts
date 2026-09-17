import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedMessage } from "@/lib/communities/cache";
import { collectPendingMentions } from "./mention-jumps";

const ME = "user-me";
const THEM = "user-them";

function message(
  id: string,
  createdAt: string,
  mentions: Array<{ user_id: string; name: string }>,
  overrides: Partial<CachedMessage> = {},
): CachedMessage {
  return {
    id,
    content: "hello",
    created_at: createdAt,
    user_id: THEM,
    users: { name: "john", avatar_url: null },
    mentions,
    ...overrides,
  };
}

const MENTION_ME = [{ user_id: ME, name: "Sachin" }];
const MENTION_OTHER = [{ user_id: "user-someone-else", name: "Aman" }];

test("a mention newer than the read marker is pending", () => {
  const messages = [message("m2", "2026-09-17T10:30:00Z", MENTION_ME)];
  const pending = collectPendingMentions(messages, ME, "2026-09-17T10:00:00Z");
  assert.deepEqual(pending.map((m) => m.id), ["m2"]);
});

test("a mention already read does not raise the pill", () => {
  const messages = [message("m1", "2026-09-17T09:30:00Z", MENTION_ME)];
  const pending = collectPendingMentions(messages, ME, "2026-09-17T10:00:00Z");
  assert.deepEqual(pending, []);
});

test("without a read marker every loaded mention counts", () => {
  const messages = [message("m1", "2026-09-17T09:30:00Z", MENTION_ME)];
  assert.deepEqual(
    collectPendingMentions(messages, ME, null).map((m) => m.id),
    ["m1"],
  );
  assert.deepEqual(
    collectPendingMentions(messages, ME, undefined).map((m) => m.id),
    ["m1"],
  );
});

test("mentions of other members and the member's own messages are ignored", () => {
  const messages = [
    message("other", "2026-09-17T10:30:00Z", MENTION_OTHER),
    message("mine", "2026-09-17T10:31:00Z", MENTION_ME, { user_id: ME }),
    message("plain", "2026-09-17T10:32:00Z", []),
    message("temp-1", "2026-09-17T10:33:00Z", MENTION_ME, { user_id: ME }),
  ];
  assert.deepEqual(collectPendingMentions(messages, ME, null), []);
});

test("mentions already jumped to stay out of the queue", () => {
  const messages = [
    message("m1", "2026-09-17T10:30:00Z", MENTION_ME),
    message("m2", "2026-09-17T10:31:00Z", MENTION_ME),
  ];
  assert.deepEqual(
    collectPendingMentions(messages, ME, null, ["m2"]).map((m) => m.id),
    ["m1"],
  );
});

test("pending mentions are newest first", () => {
  const messages = [
    message("middle", "2026-09-17T10:30:00Z", MENTION_ME),
    message("oldest", "2026-09-17T10:00:00Z", MENTION_ME),
    message("newest", "2026-09-17T10:45:00Z", MENTION_ME),
  ];
  assert.deepEqual(
    collectPendingMentions(messages, ME, null).map((m) => m.id),
    ["newest", "middle", "oldest"],
  );
});
