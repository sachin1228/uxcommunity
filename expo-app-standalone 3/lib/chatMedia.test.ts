import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAT_MEDIA_FALLBACK_RATIO,
  CHAT_MEDIA_MAX_HEIGHT,
  CHAT_MEDIA_MAX_WIDTH,
  CHAT_MEDIA_MIN_HEIGHT,
  chatMediaFrame,
  recentChatMediaUrls,
} from './chatMedia';

// ─── Frames ───────────────────────────────────────────────────────────────

test('landscape images keep the full media width', () => {
  assert.deepEqual(chatMediaFrame(16 / 9), { width: CHAT_MEDIA_MAX_WIDTH, height: 135 });
});

test('portrait images narrow instead of growing past the max height', () => {
  const frame = chatMediaFrame(0.5);
  assert.equal(frame.height, CHAT_MEDIA_MAX_HEIGHT);
  assert.equal(frame.width, CHAT_MEDIA_MAX_HEIGHT * 0.5);
});

test('panoramas flatten to the minimum height and narrow with it', () => {
  const frame = chatMediaFrame(8);
  assert.equal(frame.height, CHAT_MEDIA_MIN_HEIGHT);
  assert.equal(frame.width, Math.min(CHAT_MEDIA_MIN_HEIGHT * 8, CHAT_MEDIA_MAX_WIDTH));
});

test('unknown or unusable ratios reserve the same 4:3 frame', () => {
  const fallback = chatMediaFrame(null);
  assert.equal(fallback.width, CHAT_MEDIA_MAX_WIDTH);
  assert.equal(fallback.height, Math.round(CHAT_MEDIA_MAX_WIDTH / CHAT_MEDIA_FALLBACK_RATIO));

  assert.deepEqual(chatMediaFrame(0), fallback);
  assert.deepEqual(chatMediaFrame(-2), fallback);
  assert.deepEqual(chatMediaFrame(Number.NaN), fallback);
});

test('every frame has a positive box', () => {
  for (const ratio of [0.01, 0.1, 0.5, 1, 4 / 3, 16 / 9, 100]) {
    const frame = chatMediaFrame(ratio);
    assert.ok(frame.width > 0, `width for ${ratio}`);
    assert.ok(frame.height > 0, `height for ${ratio}`);
  }
});

// ─── Warming scope ────────────────────────────────────────────────────────

test('only the newest messages of a page are warmed', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    image_url: `https://cdn.test/${index}.png`,
  }));

  assert.deepEqual(recentChatMediaUrls(messages, 3), [
    'https://cdn.test/19.png',
    'https://cdn.test/18.png',
    'https://cdn.test/17.png',
  ]);
});

test('image-less messages, duplicates and empty URLs are skipped', () => {
  const messages = [
    { image_url: 'https://cdn.test/a.webp' },
    { image_url: null },
    { image_url: 'https://cdn.test/a.webp' },
    { image_url: '' },
    { image_url: 'https://cdn.test/b.gif' },
  ];

  assert.deepEqual(recentChatMediaUrls(messages, 10), [
    'https://cdn.test/b.gif',
    'https://cdn.test/a.webp',
  ]);
  assert.deepEqual(recentChatMediaUrls([], 10), []);
});
