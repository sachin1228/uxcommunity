import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { COMMENT_PAGE_MAX, COMMENT_PAGE_SIZE, commentPageQuery, parseCommentPageRequest } from "./comment-page-cursor.ts";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { mergeCommentRoots, mergeCommentRows } from "./comment-tree.ts";

/**
 * The comment list's paging helpers.
 *
 * The bound itself — how many comments a page holds, that its replies ride with
 * it, that two consecutive pages cover the list exactly once — is asserted in
 * SQL, against the real functions (supabase/tests/comment_page_cursor.test.sql),
 * because that is where the cursor is evaluated. What is unit-tested here is the
 * application's half: reading a cursor off a request, building the next request,
 * and merging a page into the list the reader is looking at.
 */

const CURSOR = {
  before: "2026-01-01T00:00:00.000Z",
  beforeId: "11111111-2222-3333-4444-555555555555",
};

const params = (query: Record<string, string>) => new URLSearchParams(query);

test("a request with no cursor asks for the newest page", () => {
  const request = parseCommentPageRequest(params({}));
  assert.equal(request.cursor, null);
  assert.equal(request.limit, COMMENT_PAGE_SIZE);
});

test("both halves of a cursor are read back, normalized", () => {
  const request = parseCommentPageRequest(
    params({ before: "2026-01-01T05:30:00+05:30", beforeId: "11111111-2222-3333-4444-555555555555" }),
  );
  assert.deepEqual(request.cursor, { before: "2026-01-01T00:00:00.000Z", beforeId: CURSOR.beforeId });
});

test("a half cursor is refused — the newest page is served instead", () => {
  // A lone timestamp is not the cursor the list uses: paging on it alone can
  // split a burst that shares one millisecond, so a caller that lost half of it
  // starts over rather than being served a page from a bound it did not mean.
  assert.equal(parseCommentPageRequest(params({ before: CURSOR.before })).cursor, null);
  assert.equal(parseCommentPageRequest(params({ beforeId: CURSOR.beforeId })).cursor, null);
});

test("a malformed cursor half is refused", () => {
  assert.equal(
    parseCommentPageRequest(params({ before: CURSOR.before, beforeId: "not-a-uuid" })).cursor,
    null,
  );
  assert.equal(
    parseCommentPageRequest(params({ before: "not-a-date", beforeId: CURSOR.beforeId })).cursor,
    null,
  );
});

test("the limit is clamped to what the database will actually return", () => {
  assert.equal(parseCommentPageRequest(params({ limit: "5" })).limit, 5);
  // The SQL clamps to 50; asking for more must not promise more than arrives.
  assert.equal(parseCommentPageRequest(params({ limit: "5000" })).limit, COMMENT_PAGE_MAX);
  assert.equal(parseCommentPageRequest(params({ limit: "0" })).limit, 1);
  assert.equal(parseCommentPageRequest(params({ limit: "-3" })).limit, 1);
  assert.equal(parseCommentPageRequest(params({ limit: "lots" })).limit, COMMENT_PAGE_SIZE);
});

test("the next request carries the cursor and the same limit", () => {
  assert.equal(commentPageQuery(null, 20), "?limit=20");
  assert.equal(
    commentPageQuery(CURSOR, 20),
    `?before=2026-01-01T00%3A00%3A00.000Z&beforeId=${CURSOR.beforeId}&limit=20`,
  );
});

// ── Merging an older page into the list on screen ───────────────────────────

type Row = { id: string; parent_id?: string | null; body: string; replies?: Row[] };

const root = (id: string, replies: Row[] = []): Row => ({ id, body: `root ${id}`, replies });
const reply = (id: string, parentId: string): Row => ({ id, parent_id: parentId, body: `reply ${id}` });

test("an older page is appended, so the reader's next scroll is the oldest", () => {
  const merged = mergeCommentRoots([root("c")], [root("a"), root("b")]);
  assert.deepEqual(merged.map((row) => row.id), ["c", "a", "b"]);
});

test("a root that is already on screen is never rendered twice", () => {
  const merged = mergeCommentRoots([root("b"), root("a")], [root("a")]);
  assert.deepEqual(merged.map((row) => row.id), ["b", "a"]);
});

test("a root already on screen still gains the replies the new page brought", () => {
  // The reader's own comment can be a root the page also carries; dropping the
  // page's copy of it would drop the replies that arrived with it.
  const merged = mergeCommentRoots([root("a", [reply("r1", "a")])], [root("a", [reply("r1", "a"), reply("r2", "a")])]);
  assert.deepEqual(merged[0].replies?.map((row) => row.id), ["r1", "r2"]);
});

test("the flat list merges the same way, by id", () => {
  const merged = mergeCommentRows(
    [root("a"), reply("r1", "a")],
    [root("a"), reply("r1", "a"), reply("r2", "a"), root("b")],
  );
  assert.deepEqual(merged.map((row) => row.id), ["a", "r1", "r2", "b"]);
});
