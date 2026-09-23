import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";
import {
  contentIsNewerThanLastMessage,
  formatContentPreview,
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
