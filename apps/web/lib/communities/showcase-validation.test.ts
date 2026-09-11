import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { parseShowcaseBody } from "./showcase-validation.ts";

const VIDEO = "https://media.example.com/showcase/c1/u1/123-abc.mp4";
const POSTER = "https://media.example.com/showcase/c1/u1/123-abc.mp4-poster.jpg";

function baseBody(attachments: unknown) {
  return { title: "My work", category: "motion", attachments, is_public: true };
}

test("video attachments accept and keep a valid poster URL", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: VIDEO, type: "video/mp4", size: 1000, poster: POSTER },
  ]));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.attachments[0]?.poster, POSTER);
  }
});

test("non-video attachments drop a supplied poster field", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "shot.jpg", url: "https://media.example.com/a.jpg", type: "image/jpeg", size: 10, poster: POSTER },
  ]));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.attachments[0]?.poster, undefined);
  }
});

test("posters with invalid URLs are rejected", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: VIDEO, type: "video/mp4", size: 1000, poster: "javascript:alert(1)" },
  ]));
  assert.deepEqual(parsed, { ok: false, error: "Invalid attachment poster URL." });
});

test("posters without a protocol are rejected", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: VIDEO, type: "video/mp4", size: 1000, poster: "/showcase/poster.jpg" },
  ]));
  assert.deepEqual(parsed, { ok: false, error: "Invalid attachment poster URL." });
});

test("oversized poster URLs are rejected", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: VIDEO, type: "video/mp4", size: 1000, poster: `https://x.com/${"a".repeat(2100)}` },
  ]));
  assert.deepEqual(parsed, { ok: false, error: "Invalid attachment poster URL." });
});

test("attachments without a poster keep parsing exactly as before", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: VIDEO, type: "video/mp4", size: 1000 },
  ]));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const first = parsed.value.attachments[0];
    assert.equal(first?.poster, undefined);
    assert.equal(first?.url, VIDEO);
  }
});

// ── Centralized video pipeline: mediaId / status attachments ────────────────

const MEDIA_ID = "11111111-1111-1111-1111-111111111111";

test("videos with a mediaId still require a real URL (plain uploads)", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId: MEDIA_ID, status: "ready" },
  ]));
  assert.deepEqual(parsed, { ok: false, error: "Invalid attachment URL." });
});

test("ready videos still require a real URL", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId: MEDIA_ID, status: "ready" },
  ]));
  assert.deepEqual(parsed, { ok: false, error: "Invalid attachment URL." });
});

test("empty URL without a mediaId is rejected", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: "", type: "video/mp4", size: 0, status: "processing" },
  ]));
  assert.deepEqual(parsed, { ok: false, error: "Invalid attachment URL." });
});

test("malformed media IDs are rejected", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: "", type: "video/mp4", size: 0, mediaId: "../../etc/passwd", status: "processing" },
  ]));
  assert.equal(parsed.ok, false);
});

test("unknown statuses are dropped silently (treated as a plain attachment)", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "clip.mp4", url: VIDEO, type: "video/mp4", size: 1000, status: "nonsense" },
  ]));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.attachments[0]?.status, undefined);
});

test("images ignore mediaId/status fields entirely", () => {
  const parsed = parseShowcaseBody(baseBody([
    { name: "shot.jpg", url: "https://media.example.com/a.jpg", type: "image/jpeg", size: 10, mediaId: MEDIA_ID, status: "processing" },
  ]));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.attachments[0]?.mediaId, undefined);
    assert.equal(parsed.value.attachments[0]?.status, undefined);
  }
});
