import test from "node:test";
import assert from "node:assert/strict";

import { removalSnapshotMediaUrls } from "./r2-removal-refs";

const CDN = "https://cdn.example.test";

// Thread attachments are plain media: only showcase videos get a separate
// poster object (SHOWCASE_POSTER_LOOKUP), so the extractor mirrors that.
test("a snapshotted thread keeps its attachments", () => {
  const urls = removalSnapshotMediaUrls(
    {
      version: 1,
      content: {
        id: "t1",
        attachments: [
          { url: `${CDN}/threads/a.png`, type: "image/png" },
          { url: `${CDN}/threads/v.mp4`, type: "video/mp4" },
        ],
      },
      children: {},
    },
    "thread",
    "t1",
  );

  assert.deepEqual(urls.map((entry) => entry.url).sort(), [
    `${CDN}/threads/a.png`,
    `${CDN}/threads/v.mp4`,
  ]);
  assert.equal(urls[0].table, "community_threads");
  assert.equal(urls[0].entityType, "thread");
  assert.equal(urls[0].column, "attachments");
});

test("a snapshotted showcase keeps its cover, attachments and posters", () => {
  const urls = removalSnapshotMediaUrls(
    {
      content: {
        id: "s1",
        image_url: `${CDN}/showcase/cover.png`,
        attachments: [{ url: `${CDN}/showcase/clip.mp4`, type: "video/mp4", poster: `${CDN}/showcase/poster.jpg` }],
      },
      children: {},
    },
    "showcase",
    "s1",
  );

  assert.deepEqual(urls.map((entry) => entry.url).sort(), [
    `${CDN}/showcase/clip.mp4`,
    `${CDN}/showcase/cover.png`,
    `${CDN}/showcase/poster.jpg`,
  ]);
});

test("a snapshotted event keeps its cover and its comment images", () => {
  const urls = removalSnapshotMediaUrls(
    {
      content: { id: "e1", cover_image_url: `${CDN}/events/cover.png` },
      children: {
        event_comments: [
          { id: "c1", image_url: `${CDN}/events/comment-1.png` },
          { id: "c2", image_url: null },
        ],
      },
    },
    "event",
    "e1",
  );

  assert.deepEqual(urls.map((entry) => entry.url).sort(), [
    `${CDN}/events/comment-1.png`,
    `${CDN}/events/cover.png`,
  ]);
  const comment = urls.find((entry) => entry.table === "event_comments");
  assert.equal(comment?.entityType, "event_comment");
  assert.equal(comment?.column, "image_url");
});

test("the same object referenced twice is reported once", () => {
  const urls = removalSnapshotMediaUrls(
    {
      content: { cover_image_url: `${CDN}/events/shared.png` },
      children: { event_comments: [{ id: "c1", image_url: `${CDN}/events/shared.png` }] },
    },
    "event",
    "e1",
  );

  assert.deepEqual(urls.map((entry) => entry.url), [`${CDN}/events/shared.png`]);
});

test("resources carry no bucket media and junk snapshots are ignored", () => {
  assert.deepEqual(removalSnapshotMediaUrls(null, "thread", "t"), []);
  assert.deepEqual(removalSnapshotMediaUrls("nonsense", "thread", "t"), []);
  assert.deepEqual(
    removalSnapshotMediaUrls(
      { content: { url: "https://example.com/an-article", description: "text only" } },
      "resource",
      "r1",
    ),
    [],
  );
  assert.deepEqual(
    removalSnapshotMediaUrls(
      { content: { attachments: [{ url: `${CDN}/x.png` }] } },
      "chat_message",
      "unknown-1",
    ),
    [],
  );
});

test("empty and malformed child rows contribute nothing", () => {
  const urls = removalSnapshotMediaUrls(
    {
      content: { attachments: [{ url: "" }, null, "raw-string"] },
      children: { event_comments: [null, "junk", { id: "c1", image_url: null }] },
    },
    "event",
    "e1",
  );

  assert.deepEqual(urls, []);
});
