import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { isAllowedDmImageUrl, resolveDmImage } from "./assets";

const CONV = "dec0de00-0000-4000-8000-000000000001";
const OTHER_CONV = "dec0de00-0000-4000-8000-000000000002";

beforeEach(() => {
  process.env.R2_PUBLIC_URL = "https://cdn.example.test";
});

// ─── Our own storage ──────────────────────────────────────────────────────
//
// A send's image_url is client input. Only an upload under THIS
// conversation's `dm/<id>/` prefix may be attached — an asset from another
// conversation, a community upload, or a lookalike bucket is rejected before
// any insert.

test("accepts this conversation's own upload", () => {
  assert.equal(
    isAllowedDmImageUrl(`https://cdn.example.test/dm/${CONV}/1730000000-ab.webp`, CONV),
    true,
  );
});

test("rejects another conversation's asset", () => {
  assert.equal(
    isAllowedDmImageUrl(`https://cdn.example.test/dm/${OTHER_CONV}/1730000000-ab.webp`, CONV),
    false,
  );
});

test("rejects assets from other buckets/prefixes (community chat, avatars)", () => {
  assert.equal(
    isAllowedDmImageUrl("https://cdn.example.test/chat/aaaaaaaa/1.webp", CONV),
    false,
  );
  assert.equal(
    isAllowedDmImageUrl("https://cdn.example.test/avatars/u1.webp", CONV),
    false,
  );
  assert.equal(
    isAllowedDmImageUrl("https://cdn.example.test/dm/1730000000-ab.webp", CONV),
    false,
  );
});

test("rejects a lookalike host that merely contains our base", () => {
  assert.equal(
    isAllowedDmImageUrl(`https://cdn.example.test.evil.com/dm/${CONV}/x.webp`, CONV),
    false,
  );
});

test("path traversal is resolved by URL rules before the prefix check", () => {
  // `/dm/<conv>/../../other/x` normalizes to `/other/x`, which fails the
  // `dm/<conversationId>/` prefix — the check runs on the resolved href, so
  // no encoded `..` can smuggle a foreign key past it.
  assert.equal(
    isAllowedDmImageUrl(`https://cdn.example.test/dm/${CONV}/../../other/x.webp`, CONV),
    false,
  );
});

test("accepts this conversation's private upload path and resolves its key", () => {
  const path = `/api/private/dm/${CONV}/0d1f8d1e-1111-4111-8111-111111111111.webp`;
  assert.equal(isAllowedDmImageUrl(path, CONV), true);
  assert.deepEqual(resolveDmImage(path, CONV), {
    url: path,
    key: `dm/${CONV}/0d1f8d1e-1111-4111-8111-111111111111.webp`,
  });
});

test("rejects another conversation's private upload path", () => {
  assert.equal(
    isAllowedDmImageUrl(`/api/private/dm/${OTHER_CONV}/abc.webp`, CONV),
    false,
  );
  assert.equal(
    isAllowedDmImageUrl(`/api/private/dm/${CONV}/../abc.webp`, CONV),
    false,
  );
  assert.equal(resolveDmImage(`/api/private/dm/${OTHER_CONV}/abc.webp`, CONV), null);
});

test("legacy public uploads stay URL-backed until migration", () => {
  const url = `https://cdn.example.test/dm/${CONV}/1730000000-ab.webp`;
  assert.deepEqual(resolveDmImage(url, CONV), { url, key: null });
});

// ─── GIPHY ────────────────────────────────────────────────────────────────

test("accepts GIPHY media hosts (the picker's own URLs)", () => {
  assert.equal(isAllowedDmImageUrl("https://media.giphy.com/media/abc/giphy.gif", CONV), true);
  assert.equal(isAllowedDmImageUrl("https://media3.giphy.com/media/abc/giphy.gif", CONV), true);
  assert.equal(isAllowedDmImageUrl("https://i.giphy.com/abc.gif", CONV), true);
});

test("rejects lookalike GIPHY hosts", () => {
  assert.equal(isAllowedDmImageUrl("https://media.giphy.com.evil.com/x.gif", CONV), false);
  assert.equal(isAllowedDmImageUrl("https://notgiphy.com/x.gif", CONV), false);
  assert.equal(isAllowedDmImageUrl("https://giphy.com.evil.com/x.gif", CONV), false);
});

// ─── General ──────────────────────────────────────────────────────────────

test("rejects non-https, malformed and empty values", () => {
  assert.equal(isAllowedDmImageUrl("http://cdn.example.test/dm/x/1.webp", CONV), false);
  assert.equal(isAllowedDmImageUrl("javascript:alert(1)", CONV), false);
  assert.equal(isAllowedDmImageUrl("not a url", CONV), false);
  assert.equal(isAllowedDmImageUrl("", CONV), false);
  assert.equal(isAllowedDmImageUrl("https://random.example.org/pic.png", CONV), false);
});
