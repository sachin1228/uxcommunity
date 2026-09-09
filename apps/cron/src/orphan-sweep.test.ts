import test from "node:test";
import assert from "node:assert/strict";

import { selectOrphanCandidates, type R2ObjectInfo } from "./orphan-sweep";
import { attachmentUrls, attachmentPosterUrls, r2KeyFromUrl } from "@uxcommunity/shared";

const DAY = 86_400_000;

function object(key: string, ageMs: number): R2ObjectInfo {
  return {
    key,
    size: 100,
    lastModified: new Date(Date.now() - ageMs).toISOString(),
  };
}

test("selectOrphanCandidates keeps only unreferenced objects older than the grace period", () => {
  const objects = [
    object("avatars/user-1/old.webp", 30 * DAY),   // old + unreferenced → eligible
    object("avatars/user-1/recent.webp", DAY),     // young + unreferenced → skipped
    object("chat/c-1/ref.webp", 90 * DAY),         // old but referenced → skipped
    { key: "master-data/no-date.webp", size: 10, lastModified: null }, // unknown age → skipped
  ];
  const referenced = new Set(["chat/c-1/ref.webp"]);

  const candidates = selectOrphanCandidates(objects, referenced, 7);
  assert.deepEqual(
    candidates.map((c) => c.key),
    ["avatars/user-1/old.webp"],
  );
});

test("selectOrphanCandidates treats exactly-grace-age objects as eligible", () => {
  const objects = [object("threads/t-1/file.pdf", 7 * DAY)];
  const candidates = selectOrphanCandidates(objects, new Set(), 7);
  assert.equal(candidates.length, 1);
});

test("selectOrphanCandidates with zero grace days keeps any aged unreferenced object", () => {
  const objects = [object("showcase/s-1/v.mp4", 5 * DAY)];
  assert.equal(selectOrphanCandidates(objects, new Set(), 0).length, 1);
});

test("r2KeyFromUrl extracts keys only for the configured public base", () => {
  const base = "https://media.uxcommunity.in";
  assert.equal(r2KeyFromUrl(`${base}/showcase/1/v.mp4`, base), "showcase/1/v.mp4");
  assert.equal(r2KeyFromUrl("https://other.example/x.png", base), null);
  assert.equal(r2KeyFromUrl("https://pub-1.r2.dev/x.png", base), null);
  // Trailing slash on the base must not break matching.
  assert.equal(r2KeyFromUrl(`${base}/avatars/u/a.png`, base + "/"), "avatars/u/a.png");
});

test("shared attachment extraction matches the web app's parsing", () => {
  const attachments = [
    { name: "v.mp4", url: "https://media.uxcommunity.in/showcase/1/v.mp4", type: "video/mp4", size: 1, poster: "https://media.uxcommunity.in/showcase/1/v-poster.webp" },
    { name: "broken" },
    null,
  ];
  assert.deepEqual(attachmentUrls(attachments), ["https://media.uxcommunity.in/showcase/1/v.mp4"]);
  assert.deepEqual(attachmentPosterUrls(attachments), ["https://media.uxcommunity.in/showcase/1/v-poster.webp"]);
});