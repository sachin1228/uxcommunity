import assert from "node:assert/strict";
import { test } from "node:test";
import { messagePreview, reactionPreviewText } from "./preview-text";
import type { DmPreviewMessage } from "./types";

function preview(extra: Partial<DmPreviewMessage> = {}): DmPreviewMessage {
  return {
    id: "m1",
    content: "hi",
    image_url: null,
    created_at: "2026-10-12T12:00:00.000Z",
    user_id: "peer",
    deleted_at: null,
    edited_at: null,
    ...extra,
  };
}

// ─── reaction preview ─────────────────────────────────────────────────────

test("quotes the reacted message's body", () => {
  assert.deepEqual(reactionPreviewText({ content: "ok", hasImage: false }), {
    text: '"ok"',
    media: null,
  });
});

test("truncates a long reacted body with an ellipsis", () => {
  const body = "x".repeat(60);
  const result = reactionPreviewText({ content: body, hasImage: false });
  assert.equal(result.text, `"${"x".repeat(40)}…"`);
  assert.equal(result.media, null);
});

test("an image-only target reads as a photo, not a camera emoji", () => {
  assert.deepEqual(reactionPreviewText({ content: null, hasImage: true }), {
    text: "Photo",
    media: "image",
  });
});

test("a target with neither text nor image falls back to a message", () => {
  assert.deepEqual(reactionPreviewText({ content: null, hasImage: false }), {
    text: "a message",
    media: null,
  });
  assert.deepEqual(reactionPreviewText(null), { text: "a message", media: null });
});

// ─── message preview ──────────────────────────────────────────────────────

test("prefixes the viewer's own message with You", () => {
  assert.deepEqual(messagePreview(preview({ user_id: "me" }), "me"), {
    prefix: "You",
    text: "hi",
    media: null,
    deleted: false,
  });
});

test("leaves the peer's message un-prefixed (the row already names them)", () => {
  assert.deepEqual(messagePreview(preview({ user_id: "peer" }), "me"), {
    prefix: null,
    text: "hi",
    media: null,
    deleted: false,
  });
});

test("an image-only message is a photo glyph, captioned images keep their text", () => {
  assert.deepEqual(
    messagePreview(preview({ content: null, image_url: "https://x/y.png" }), "me"),
    { prefix: null, text: "Photo", media: "image", deleted: false },
  );
  assert.deepEqual(
    messagePreview(preview({ content: "look", image_url: "https://x/y.png" }), "me").text,
    "look",
  );
});

test("a deleted message reads as a tombstone", () => {
  assert.deepEqual(
    messagePreview(preview({ user_id: "me", deleted_at: "2026-10-12T12:01:00.000Z" }), "me"),
    { prefix: "You", text: "This message was deleted", media: null, deleted: true },
  );
});

test("no message yields an empty preview", () => {
  assert.deepEqual(messagePreview(null, "me"), {
    prefix: null,
    text: "",
    media: null,
    deleted: false,
  });
});
