import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";
import {
  contentIsNewerThanLastMessage,
  formatContentPreview,
  formatMessagePreview,
} from "./sidebar-content";

function content(overrides: Partial<Parameters<typeof formatContentPreview>[0]> = {}) {
  return {
    id: "c1",
    kind: "thread" as const,
    title: "Design systems at scale",
    created_at: "2026-09-17T10:00:00Z",
    isOwn: false,
    firstName: null,
    ...overrides,
  };
}

function community(lastMessageAt: string | null): Pick<CachedSidebarCommunity, "last_message"> {
  return {
    last_message: lastMessageAt
      ? { id: "m1", content: "hi", created_at: lastMessageAt, user: { name: "sachin" } }
      : null,
  };
}

test("content preview mirrors the chat timeline language", () => {
  assert.deepEqual(formatContentPreview(content()), {
    prefix: "Someone",
    text: "created a thread",
  });
});

test("content preview uses the author's first name", () => {
  assert.deepEqual(
    formatContentPreview(content({ firstName: "john doe" })),
    { prefix: "john", text: "created a thread" },
  );
});

test("own content previews as You with the kind noun", () => {
  for (const [kind, article, noun] of [
    ["thread", "a", "thread"],
    ["showcase", "a", "showcase"],
    ["resource", "a", "resource"],
    ["event", "an", "event"],
  ] as const) {
    assert.deepEqual(
      formatContentPreview(content({ kind, isOwn: true, firstName: "sachin" })),
      { prefix: "You", text: `created ${article} ${noun}` },
    );
  }
});

test("content beats a message that arrived earlier", () => {
  assert.equal(
    contentIsNewerThanLastMessage(content(), community("2026-09-17T09:59:00Z")),
    true,
  );
});

test("a newer message wins the preview back", () => {
  assert.equal(
    contentIsNewerThanLastMessage(content(), community("2026-09-17T10:01:00Z")),
    false,
  );
});

test("content shows when the community has no messages yet", () => {
  assert.equal(contentIsNewerThanLastMessage(content(), community(null)), true);
});

function message(
  overrides: Partial<Parameters<typeof formatMessagePreview>[0]> = {},
): Parameters<typeof formatMessagePreview>[0] {
  return {
    id: "m1",
    content: "hi",
    created_at: "2026-09-17T10:00:00Z",
    user: { name: "john doe" },
    ...overrides,
  };
}

test("message preview uses the sender's first name", () => {
  assert.deepEqual(formatMessagePreview(message()), { prefix: "john", text: "hi" });
});

test("own messages preview as You", () => {
  assert.deepEqual(formatMessagePreview(message({ is_own: true })), {
    prefix: "You",
    text: "hi",
  });
});

test("a reply previews the person it answers", () => {
  assert.deepEqual(
    formatMessagePreview(message({ is_reply: true, reply_to_user: "sachin" })),
    { prefix: "john", text: "replied to sachin: hi" },
  );
});

test("a reply anchored to a content card names the kind, not a person", () => {
  for (const [kind, article] of [
    ["thread", "a"],
    ["showcase", "a"],
    ["resource", "a"],
    ["event", "an"],
  ] as const) {
    assert.deepEqual(
      formatMessagePreview(
        message({
          content: "nice one",
          is_own: true,
          is_reply: true,
          reply_to_user: null,
          reply_to_content_kind: kind,
        }),
      ),
      { prefix: "You", text: `replied to ${article} ${kind}: nice one` },
    );
  }
});

test("an image-only message previews as a photo", () => {
  assert.deepEqual(
    formatMessagePreview(message({ content: "", has_image: true })),
    { prefix: "john", text: "📷 Photo" },
  );
});

test("a deleted message never leaks its body", () => {
  assert.deepEqual(
    formatMessagePreview(message({ is_deleted: true })),
    { prefix: "john", text: "Message deleted" },
  );
});
