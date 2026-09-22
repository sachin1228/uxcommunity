import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engagementOf,
  rankTrendingPosts,
  trendingScore,
  type TrendingPostCandidate,
} from "./trending";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

function post(
  overrides: Partial<TrendingPostCandidate> & { id: string },
): TrendingPostCandidate {
  return {
    title: overrides.id,
    community_id: "c1",
    // Two hours old unless the test says otherwise.
    created_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    like_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function ids(posts: TrendingPostCandidate[]) {
  return posts.map((p) => p.id);
}

test("ranks by engagement, likes and comments counting the same", () => {
  const ranked = rankTrendingPosts(
    [
      post({ id: "quiet", like_count: 1 }),
      post({ id: "debated", like_count: 4, comment_count: 9 }),
      post({ id: "liked", like_count: 6, comment_count: 1 }),
    ],
    { now: NOW },
  );

  assert.deepEqual(ids(ranked), ["debated", "liked", "quiet"]);
});

test("counts a like and a comment as one point each", () => {
  assert.equal(engagementOf(post({ id: "a", like_count: 3, comment_count: 4 })), 7);
});

test("skips posts nobody has engaged with", () => {
  const ranked = rankTrendingPosts(
    [
      post({ id: "untouched" }),
      post({ id: "liked", like_count: 1 }),
    ],
    { now: NOW },
  );

  assert.deepEqual(ids(ranked), ["liked"]);
  assert.deepEqual(rankTrendingPosts([post({ id: "untouched" })], { now: NOW }), []);
});

test("fades engagement with age so the card keeps moving", () => {
  const fresh = post({ id: "fresh", like_count: 6, comment_count: 0 });
  const stale = post({
    id: "stale",
    like_count: 10,
    comment_count: 0,
    created_at: new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // Six days is two half-lives: 10 points become 2.5, so this week's 6 wins.
  assert.deepEqual(ids(rankTrendingPosts([stale, fresh], { now: NOW })), ["fresh", "stale"]);
});

test("a much bigger stale post can still outrank a fresh small one", () => {
  const fresh = post({ id: "fresh", like_count: 2 });
  const stale = post({
    id: "stale",
    like_count: 40,
    created_at: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
  });

  assert.deepEqual(ids(rankTrendingPosts([fresh, stale], { now: NOW })), ["stale", "fresh"]);
});

test("halves the score after one half-life", () => {
  const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();
  const start = trendingScore(post({ id: "a", like_count: 8, created_at: hoursAgo(0) }), NOW);
  const faded = trendingScore(post({ id: "b", like_count: 8, created_at: hoursAgo(72) }), NOW);

  assert.equal(start, 8);
  assert.equal(Math.round(faded * 100) / 100, 4);
});

test("keeps the same order when scores tie", () => {
  const shared = {
    like_count: 4,
    created_at: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
  };
  const ranked = rankTrendingPosts(
    [post({ id: "b", ...shared }), post({ id: "a", ...shared })],
    { now: NOW },
  );

  assert.deepEqual(ids(ranked), ["a", "b"]);
});

test("treats an unparseable timestamp as brand new instead of dropping the post", () => {
  const ranked = rankTrendingPosts(
    [post({ id: "broken", created_at: "not-a-date", like_count: 3 })],
    { now: NOW },
  );

  assert.deepEqual(ids(ranked), ["broken"]);
});

test("clamps negative counts and honours the limit", () => {
  assert.equal(engagementOf(post({ id: "weird", like_count: -5, comment_count: 2 })), 2);

  const ranked = rankTrendingPosts(
    [1, 2, 3, 4, 5, 6].map((n, index) =>
      post({ id: `p${n}`, like_count: 10 - index, created_at: new Date(NOW - index * 1000).toISOString() }),
    ),
    { now: NOW, limit: 3 },
  );

  assert.deepEqual(ids(ranked), ["p1", "p2", "p3"]);
});
