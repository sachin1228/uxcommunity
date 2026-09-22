import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateTrendingTopics, normalizeTopic } from "./trending";

test("ranks topics by how many threads used them", () => {
  const topics = aggregateTrendingTopics([
    { tags: ["Design Systems"] },
    { tags: ["Design Systems", "AI"] },
    { tags: ["AI"] },
    { tags: ["Design Systems"] },
  ]);

  assert.deepEqual(topics, [
    { topic: "Design Systems", post_count: 3, share: 75 },
    { topic: "AI", post_count: 2, share: 50 },
  ]);
});

test("counts one thread once per topic, however often the tag repeats", () => {
  const topics = aggregateTrendingTopics([{ tags: ["Portfolio", "portfolio", "Portfolio"] }]);
  assert.deepEqual(topics, [{ topic: "Portfolio", post_count: 1, share: 100 }]);
});

test("groups spellings case-insensitively under the newest one", () => {
  // Rows arrive newest-first, so the label the reader sees is the latest
  // spelling the community used.
  const topics = aggregateTrendingTopics([
    { tags: ["ux research"] },
    { tags: ["UX Research"] },
  ]);

  assert.equal(topics.length, 1);
  assert.equal(topics[0].topic, "ux research");
  assert.equal(topics[0].post_count, 2);
});

test("share is the topic's slice of the tagged threads only", () => {
  const topics = aggregateTrendingTopics([
    { tags: ["Motion"] },
    { tags: ["Motion"] },
    { tags: ["Branding"] },
    { tags: null }, // untagged thread — not part of any share
    { tags: [] },
  ]);

  const motion = topics.find((topic) => topic.topic === "Motion");
  const branding = topics.find((topic) => topic.topic === "Branding");
  assert.equal(motion?.share, 66.7);
  assert.equal(branding?.share, 33.3);
});

test("ignores blank, hashed-only and over-long tags", () => {
  const topics = aggregateTrendingTopics([
    { tags: ["   ", "#", "#  ", "a".repeat(31), "Accessibility"] },
  ]);

  assert.deepEqual(topics, [{ topic: "Accessibility", post_count: 1, share: 100 }]);
});

test("strips the leading hash and collapses inner whitespace", () => {
  assert.equal(normalizeTopic("#Design   Systems"), "Design Systems");
  assert.equal(normalizeTopic("  Accessibility  "), "Accessibility");
  assert.equal(normalizeTopic(""), null);
  assert.equal(normalizeTopic("x".repeat(31)), null);
});

test("breaks ties alphabetically so the list is stable", () => {
  const topics = aggregateTrendingTopics([
    { tags: ["Web3"] },
    { tags: ["Vibe coding"] },
  ]);

  assert.deepEqual(
    topics.map((topic) => topic.topic),
    ["Vibe coding", "Web3"],
  );
});

test("honours the limit and returns nothing without tagged threads", () => {
  const rows = ["A", "B", "C", "D", "E", "F"].map((tag) => ({ tags: [tag] }));

  assert.equal(aggregateTrendingTopics(rows, 3).length, 3);
  assert.deepEqual(aggregateTrendingTopics([{ tags: [] }, {}]), []);
  assert.deepEqual(aggregateTrendingTopics([], 5), []);
});
