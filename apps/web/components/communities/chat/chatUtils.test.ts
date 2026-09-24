import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyContentCommentCount,
  formatCommenters,
  pickOptimisticMatch,
  scrollChatToBottom,
  type OptimisticLike,
  type ScrollableLike,
} from "./chatUtils";

function scrollContainer(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ScrollableLike {
  return { scrollTop, scrollHeight, clientHeight };
}

// The repro from the bug report: the user scrolled to the top of a long
// conversation to read history, then sent a message. Their own message — the
// newest row — has to be brought into view, so this must NOT depend on how
// close the bottom already was.
test("sending while scrolled up in history jumps to the newest message", () => {
  const container = scrollContainer(0, 5_000, 800);

  scrollChatToBottom(container);

  assert.equal(container.scrollTop, 4_200);
});

test("a container already at the bottom stays pinned there", () => {
  const container = scrollContainer(4_200, 5_000, 800);

  scrollChatToBottom(container);

  assert.equal(container.scrollTop, 4_200);
});

test("a chat shorter than its viewport lands at offset zero", () => {
  const container = scrollContainer(120, 400, 800);

  scrollChatToBottom(container);

  assert.equal(container.scrollTop, 0);
});

test("no-ops while the scroll container is not mounted", () => {
  assert.doesNotThrow(() => scrollChatToBottom(null));
  assert.doesNotThrow(() => scrollChatToBottom(undefined));
});

// ─── Optimistic echo matching ─────────────────────────────────────────────

const ME = "user-me";
const THEM = "user-them";

function bubble(
  id: string,
  content: string | null,
  overrides: Partial<OptimisticLike> = {},
): OptimisticLike {
  return { id, user_id: ME, content, status: "sending", ...overrides };
}

// The repro from the bug report: two messages typed and sent back-to-back, so
// both bubbles are in flight at once. Each echo has to confirm its own bubble.
test("two in-flight sends each match their own echo", () => {
  const inFlight = [bubble("temp-1", "first"), bubble("temp-2", "second")];

  assert.equal(
    pickOptimisticMatch(inFlight, { user_id: ME, content: "first" })?.id,
    "temp-1",
  );
  assert.equal(
    pickOptimisticMatch(inFlight, { user_id: ME, content: "second" })?.id,
    "temp-2",
  );
});

// Echoes are published fire-and-forget (after() on the server), so the second
// message can be confirmed before the first. Content — not arrival order —
// decides which bubble is replaced, so no message is lost or duplicated.
test("an out-of-order echo still lands on the bubble it confirms", () => {
  const inFlight = [bubble("temp-1", "first"), bubble("temp-2", "second")];

  assert.equal(
    pickOptimisticMatch(inFlight, { user_id: ME, content: "second" })?.id,
    "temp-2",
  );
});

// "ok" sent twice in a row is indistinguishable by content — the oldest bubble
// is the one this echo belongs to, so the pairing stays first-in-first-out.
test("identical texts pair oldest-first", () => {
  const inFlight = [bubble("temp-1", "ok"), bubble("temp-2", "ok")];

  assert.equal(
    pickOptimisticMatch(inFlight, { user_id: ME, content: "ok" })?.id,
    "temp-1",
  );
});

// Image/GIF sends carry no text: the echo can only be matched by position.
test("a textless echo matches the oldest in-flight bubble", () => {
  const inFlight = [bubble("temp-1", ""), bubble("temp-2", "")];

  assert.equal(
    pickOptimisticMatch(inFlight, { user_id: ME, content: "" })?.id,
    "temp-1",
  );
});

test("another member's echo never steals my optimistic bubble", () => {
  const inFlight = [bubble("temp-1", "mine")];

  assert.equal(
    pickOptimisticMatch(inFlight, { user_id: THEM, content: "mine" }),
    null,
  );
});

test("confirmed and failed rows are not replaced by a new echo", () => {
  const rows = [
    bubble("temp-1", "failed one", { status: "failed" }),
    bubble("temp-2", "already sent", { status: "sent" }),
    bubble("real-1", "already sent"),
  ];

  assert.equal(
    pickOptimisticMatch(rows, { user_id: ME, content: "already sent" }),
    null,
  );
});

// ─── Live comment counts on the "created a …" cards ──────────────────────

function card(id: string, commentCount?: number | null, commentUsers?: string[]) {
  return {
    id,
    title: "card",
    meta:
      commentCount === undefined
        ? null
        : { comment_count: commentCount, ...(commentUsers ? { comment_users: commentUsers } : {}) },
  };
}

test("a broadcast comment total lands on the card it belongs to", () => {
  const events = [card("a", 0), card("b", 3)];

  const next = applyContentCommentCount(events, "b", 4);

  assert.equal(next?.[1]?.meta?.comment_count, 4);
  // Untouched cards keep their identity, so only one row re-renders.
  assert.equal(next?.[0], events[0]);
  assert.deepEqual(next?.map((e) => e.id), ["a", "b"]);
});

test("a deleted comment shrinks the count and a zero hides it", () => {
  const next = applyContentCommentCount([card("a", 1)], "a", 0);

  assert.equal(next?.[0]?.meta?.comment_count, 0);
});

test("an unchanged total returns null so the caller keeps its state", () => {
  assert.equal(applyContentCommentCount([card("a", 2)], "a", 2), null);
});

test("a card with no meta yet still accepts a count", () => {
  const next = applyContentCommentCount([card("a")], "a", 1);

  assert.equal(next?.[0]?.meta?.comment_count, 1);
});

test("a count for a card outside the loaded window is ignored", () => {
  const events = [card("a", 1)];

  assert.equal(applyContentCommentCount(events, "missing", 5), null);
});

// ─── Newest commenters on the card ────────────────────────────────────────

test("the newest commenters ride along with the broadcast total", () => {
  const next = applyContentCommentCount([card("a", 1, ["Ava"])], "a", 2, ["John", "Ava"]);

  assert.equal(next?.[0]?.meta?.comment_count, 2);
  assert.deepEqual(next?.[0]?.meta?.comment_users, ["John", "Ava"]);
});

test("a broadcast without names keeps the ones already on the card", () => {
  assert.equal(applyContentCommentCount([card("a", 1, ["Ava"])], "a", 1), null);

  const next = applyContentCommentCount([card("a", 1, ["Ava"])], "a", 2);
  assert.deepEqual(next?.[0]?.meta?.comment_users, ["Ava"]);
});

test("a deleted comment drops the commenter who left it", () => {
  const next = applyContentCommentCount([card("a", 2, ["Ava", "John"])], "a", 1, ["Ava"]);

  assert.equal(next?.[0]?.meta?.comment_count, 1);
  assert.deepEqual(next?.[0]?.meta?.comment_users, ["Ava"]);
});

test("renaming the same people does not re-render the card", () => {
  assert.equal(applyContentCommentCount([card("a", 2, ["Ava", "John"])], "a", 2, ["Ava", "John"]), null);
});

test("the byline joins the names and blanks out when there are none", () => {
  assert.equal(formatCommenters(["Ava", "John"]), "Ava, John");
  assert.equal(formatCommenters([]), null);
  assert.equal(formatCommenters(undefined), null);
  assert.equal(formatCommenters(["  ", "Ava"]), "Ava");
});
