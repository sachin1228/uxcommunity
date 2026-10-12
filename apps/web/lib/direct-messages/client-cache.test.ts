import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bumpConversationWithMessage,
  patchConversationReaction,
} from "./client-cache";
import type { DmConversationSummary, DmLastReaction } from "./types";

function conversation(extra: Partial<DmConversationSummary> = {}): DmConversationSummary {
  return {
    id: "c1",
    peer: { id: "peer", name: "John Doe", avatar_url: null },
    last_message: null,
    unread_count: 0,
    my_last_read_at: null,
    last_message_at: "2026-10-12T12:00:00.000Z",
    last_reaction: null,
    ...extra,
  };
}

function reaction(extra: Partial<DmLastReaction> = {}): DmLastReaction {
  return {
    messageId: "m1",
    reactorId: "peer",
    emoji: "❤️",
    createdAt: "2026-10-12T12:05:00.000Z",
    firstName: "John",
    isOwn: false,
    messagePreview: '"ok"',
    messagePreviewMedia: null,
    ...extra,
  };
}

test("sets a conversation's reaction preview", () => {
  const next = patchConversationReaction([conversation()], {
    conversationId: "c1",
    lastReaction: reaction(),
  });
  assert.equal(next[0].last_reaction?.emoji, "❤️");
});

test("ignores a delayed event for an older reaction", () => {
  const current = [conversation({ last_reaction: reaction() })];
  const older = reaction({ createdAt: "2026-10-12T11:00:00.000Z", emoji: "👍" });
  assert.equal(
    patchConversationReaction(current, { conversationId: "c1", lastReaction: older }),
    current,
  );
});

test("a refined body under the same reaction is not a no-op", () => {
  const stale = reaction({ messagePreview: "a message" });
  const current = [conversation({ last_reaction: stale })];
  const refined = { ...stale, messagePreview: '"ok"' };
  const next = patchConversationReaction(current, {
    conversationId: "c1",
    lastReaction: refined,
  });
  assert.notEqual(next, current);
  assert.equal(next[0].last_reaction?.messagePreview, '"ok"');
});

test("an unchanged reaction returns the same array (memoization)", () => {
  const current = [conversation({ last_reaction: reaction() })];
  assert.equal(
    patchConversationReaction(current, { conversationId: "c1", lastReaction: reaction() }),
    current,
  );
});

test("clearing a reaction that is not there is a no-op", () => {
  const current = [conversation()];
  assert.equal(
    patchConversationReaction(current, { conversationId: "c1", lastReaction: null }),
    current,
  );
});

test("a new message clears the reaction preview", () => {
  const current = [conversation({ last_reaction: reaction() })];
  const next = bumpConversationWithMessage(current, {
    conversationId: "c1",
    viewerId: "me",
    activelyReading: false,
    message: {
      id: "m2",
      content: "hi",
      image_url: null,
      created_at: "2026-10-12T12:10:00.000Z",
      user_id: "peer",
      deleted_at: null,
      edited_at: null,
    },
  });
  assert.equal(next[0].last_reaction, null);
});
