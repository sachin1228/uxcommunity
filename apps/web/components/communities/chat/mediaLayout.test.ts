import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_MEDIA_FALLBACK_RATIO,
  CHAT_MEDIA_INTRINSIC_WIDTH,
  cachedChatMediaRatio,
  cachedChatMediaSize,
  chatMediaIntrinsicSize,
  newestChatMediaUrls,
  normalizeChatMediaRatio,
  rememberChatMediaSize,
} from "./mediaLayout";

// ─── Size cache ───────────────────────────────────────────────────────────

test("normalizes only usable ratios", () => {
  assert.equal(normalizeChatMediaRatio(1.5), 1.5);
  assert.equal(normalizeChatMediaRatio(0), null);
  assert.equal(normalizeChatMediaRatio(-2), null);
  assert.equal(normalizeChatMediaRatio(Number.NaN), null);
  assert.equal(normalizeChatMediaRatio(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizeChatMediaRatio(undefined), null);
});

test("remembers a measured image and ignores unusable measurements", () => {
  rememberChatMediaSize("https://cdn.test/portrait.png", 800, 1600);
  assert.deepEqual(cachedChatMediaSize("https://cdn.test/portrait.png"), {
    width: 800,
    height: 1600,
  });
  assert.equal(cachedChatMediaRatio("https://cdn.test/portrait.png"), 0.5);

  rememberChatMediaSize("https://cdn.test/broken.png", 0, 0);
  assert.equal(cachedChatMediaSize("https://cdn.test/broken.png"), null);

  assert.equal(cachedChatMediaSize(null), null);
  assert.equal(cachedChatMediaSize(undefined), null);
  assert.equal(cachedChatMediaRatio(null), null);
});

test("a re-measured URL replaces its previous size", () => {
  rememberChatMediaSize("https://cdn.test/rewritten.gif", 200, 100);
  assert.equal(cachedChatMediaRatio("https://cdn.test/rewritten.gif"), 2);
  rememberChatMediaSize("https://cdn.test/rewritten.gif", 100, 200);
  assert.equal(cachedChatMediaRatio("https://cdn.test/rewritten.gif"), 0.5);
  assert.deepEqual(cachedChatMediaSize("https://cdn.test/rewritten.gif"), {
    width: 100,
    height: 200,
  });
});

// ─── Intrinsic size ───────────────────────────────────────────────────────

test("a warmed image reserves exactly the size it renders at", () => {
  // A Tenor-sized GIF must not be stretched to the message column when it is
  // painted: the bubble uses the measured width, not a nominal 1200.
  assert.deepEqual(chatMediaIntrinsicSize({ width: 200, height: 120 }), {
    width: 200,
    height: 120,
  });
  assert.deepEqual(chatMediaIntrinsicSize({ width: 800, height: 1600 }), {
    width: 800,
    height: 1600,
  });
});

test("unknown sizes fall back to 4:3, never to a zero-height image", () => {
  const fallback = chatMediaIntrinsicSize(null);
  assert.equal(fallback.width, CHAT_MEDIA_INTRINSIC_WIDTH);
  assert.equal(
    fallback.height,
    Math.round(CHAT_MEDIA_INTRINSIC_WIDTH / CHAT_MEDIA_FALLBACK_RATIO),
  );
  assert.ok(fallback.height > 0);
});

// ─── Page warming scope ───────────────────────────────────────────────────

test("only the newest messages of a page are warmed", () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    image_url: `https://cdn.test/${index}.png`,
  }));

  // Three newest images, in newest-first order.
  assert.deepEqual(newestChatMediaUrls(messages, 3), [
    "https://cdn.test/19.png",
    "https://cdn.test/18.png",
    "https://cdn.test/17.png",
  ]);
});

test("image-less messages, duplicates and empty URLs are skipped", () => {
  const messages = [
    { image_url: "https://cdn.test/a.webp" },
    { image_url: null },
    { image_url: "https://cdn.test/a.webp" },
    { image_url: "" },
    { image_url: "https://cdn.test/b.gif" },
  ];

  assert.deepEqual(newestChatMediaUrls(messages, 10), [
    "https://cdn.test/b.gif",
    "https://cdn.test/a.webp",
  ]);
  assert.deepEqual(newestChatMediaUrls([], 10), []);
});
