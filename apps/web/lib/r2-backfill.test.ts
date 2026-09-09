import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKFILL_COLUMN_GROUPS,
  contentTypeForKey,
  IMMUTABLE_CACHE_CONTROL,
  isLegacyR2DevUrl,
  r2KeyFromCurrentOrLegacyUrl,
  rewriteAttachmentsValue,
  rewriteUrlValue,
} from "./r2-backfill";

const BASE = "https://media.uxcommunity.in";
const LEGACY = "https://pub-923ef24d1eca4d4ea1424abc040cb5ed.r2.dev";

test("isLegacyR2DevUrl detects only r2.dev hosts", () => {
  assert.equal(isLegacyR2DevUrl(`${LEGACY}/avatars/u/1.webp`), true);
  assert.equal(isLegacyR2DevUrl(`${BASE}/avatars/u/1.webp`), false);
  assert.equal(isLegacyR2DevUrl("https://images.example.com/x.png"), false);
  assert.equal(isLegacyR2DevUrl("not a url"), false);
});

test("r2KeyFromCurrentOrLegacyUrl extracts keys from both domains", () => {
  assert.equal(r2KeyFromCurrentOrLegacyUrl(`${BASE}/a/b/c.webp`, BASE), "a/b/c.webp");
  assert.equal(r2KeyFromCurrentOrLegacyUrl(`${LEGACY}/a/b/c.webp`, BASE), "a/b/c.webp");
  assert.equal(r2KeyFromCurrentOrLegacyUrl("https://evil.example/a.webp", BASE), null);
  assert.equal(r2KeyFromCurrentOrLegacyUrl(`${BASE}/`, BASE), null);
});

test("rewriteUrlValue rewrites legacy strings and leaves others untouched", () => {
  const rewritten = rewriteUrlValue(`${LEGACY}/avatars/u/1.webp`, BASE);
  assert.equal(rewritten.changed, true);
  assert.equal(rewritten.count, 1);
  assert.equal(rewritten.value, `${BASE}/avatars/u/1.webp`);

  const current = rewriteUrlValue(`${BASE}/avatars/u/1.webp`, BASE);
  assert.deepEqual(current, { value: `${BASE}/avatars/u/1.webp`, changed: false, count: 0 });

  const external = rewriteUrlValue("https://cdn.example.com/x.png", BASE);
  assert.equal(external.changed, false);

  const nonString = rewriteUrlValue(null, BASE);
  assert.equal(nonString.changed, false);
});

test("rewriteAttachmentsValue rewrites url and poster fields", () => {
  const input = [
    { url: `${LEGACY}/showcase/v.mp4`, poster: `${LEGACY}/showcase/v-poster.webp` },
    { url: `${BASE}/showcase/keep.webp` },
    { url: "https://cdn.example.com/ext.png" },
    "not-an-object",
  ];
  const result = rewriteAttachmentsValue(input, BASE);
  assert.equal(result.changed, true);
  assert.equal(result.count, 2);
  const [first, second, , fourth] = result.value as Array<Record<string, unknown>>;
  assert.equal(first.url, `${BASE}/showcase/v.mp4`);
  assert.equal(first.poster, `${BASE}/showcase/v-poster.webp`);
  assert.equal(second.url, `${BASE}/showcase/keep.webp`);
  assert.equal(fourth, "not-an-object");
});

test("rewriteAttachmentsValue passes through non-arrays and legacy-free arrays", () => {
  assert.equal(rewriteAttachmentsValue("string", BASE).changed, false);
  const clean = rewriteAttachmentsValue([{ url: `${BASE}/a.png` }], BASE);
  assert.equal(clean.changed, false);
});

test("contentTypeForKey covers every media extension the app stores", () => {
  assert.equal(contentTypeForKey("a/b/x.webp"), "image/webp");
  assert.equal(contentTypeForKey("video.mp4"), "video/mp4");
  assert.equal(contentTypeForKey("song.M4A"), "audio/mp4");
  assert.equal(contentTypeForKey("file.pdf"), "application/pdf");
  assert.equal(contentTypeForKey("anim.json"), "application/json");
  assert.equal(contentTypeForKey("noext"), null);
});

test("column groups mirror the lifecycle lookups exactly", () => {
  const keys = BACKFILL_COLUMN_GROUPS.map((g) => `${g.table}.${g.column}`).sort();
  assert.equal(new Set(keys).size, keys.length, "no duplicate table.column groups");
  assert.ok(keys.includes("designer_profiles.avatar_url"));
  assert.ok(keys.includes("community_threads.attachments"));
  const attachments = BACKFILL_COLUMN_GROUPS.filter((g) => g.kind === "attachments");
  assert.equal(attachments.length, 2);
});

test("IMMUTABLE_CACHE_CONTROL matches the upload header", () => {
  assert.equal(IMMUTABLE_CACHE_CONTROL, "public, max-age=31536000, immutable");
});
