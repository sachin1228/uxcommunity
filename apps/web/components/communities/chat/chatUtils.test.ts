import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anchorOffset,
  applyContentCommentCount,
  formatCommenters,
  isEmojiOnly,
  pickOptimisticMatch,
  scrollAnchorDelta,
  scrollChatToBottom,
  splitEmojiClusters,
  type OptimisticLike,
  type ScrollableLike,
  type ScrollAnchor,
} from "./chatUtils";

// ─── Emoji-only messages ──────────────────────────────────────────────────
//
// A 2–3 emoji message renders as jumbo emoji outside the bubble; four or more
// stay in a normal text bubble. The glyph split is what lets each of those
// jumbo emoji animate on its own instead of asking the asset layer for a
// nonexistent combined codepoint key ("1f600_1f603").

test("one, two and three emoji are emoji-only; four are not", () => {
  assert.equal(isEmojiOnly("😀"), true);
  assert.equal(isEmojiOnly("😀😃"), true);
  assert.equal(isEmojiOnly("😀😃😄"), true);
  assert.equal(isEmojiOnly("😀😃😄😁"), false);
});

test("whitespace and blank input around the glyphs", () => {
  assert.equal(isEmojiOnly("  😀😃  "), true);
  assert.equal(isEmojiOnly("😀 😃"), true);
  assert.equal(isEmojiOnly(""), false);
  assert.equal(isEmojiOnly("   "), false);
});

test("emoji mixed with text or a link is not emoji-only", () => {
  assert.equal(isEmojiOnly("hi 😀"), false);
  assert.equal(isEmojiOnly("😀 https://x.dev"), false);
  assert.equal(isEmojiOnly("2"), false);
});

test("a ZWJ sequence and a skin-toned emoji each count once", () => {
  assert.equal(isEmojiOnly("👨‍👩‍👧"), true);
  assert.equal(isEmojiOnly("👍🏽👍🏽👍🏽"), true);
  assert.equal(isEmojiOnly("👍🏽👍🏽👍🏽👍🏽"), false);
});

test("splitting yields one entry per rendered glyph, in order", () => {
  assert.deepEqual(splitEmojiClusters("😀😃😄"), ["😀", "😃", "😄"]);
  // Whitespace between jumbo emoji must not become its own entry on the row.
  assert.deepEqual(splitEmojiClusters("😀 😃"), ["😀", "😃"]);
  // ZWJ families stay a single glyph rather than splitting into members.
  assert.deepEqual(splitEmojiClusters("👨‍👩‍👧👍🏽"), ["👨‍👩‍👧", "👍🏽"]);
  assert.deepEqual(splitEmojiClusters("no emoji here"), []);
});

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

// ─── Scroll-anchor compensation ───────────────────────────────────────────
//
// The message list keeps the oldest real message as a fixed scroll anchor. Any
// height inserted or removed *above* it — an older page being prepended, or the
// load-older slot disappearing once history runs out — is added to scrollTop,
// so the rows the user is reading stay exactly where they are.

/** The scroll container's top edge, in viewport coordinates. */
const CONTAINER_TOP = 200;

/**
 * A DOM-free stand-in for the list content: rows stacked in order beneath an
 * optional "load older" slot. `scrollTop` slides that content past the
 * container's top edge exactly like the real overflow container.
 */
function messageList(
  rows: [id: string, height: number][],
  slotHeight: number,
  initialScrollTop: number,
) {
  let top = initialScrollTop;
  let slot = slotHeight;

  const offsetOf = (id: string): number => {
    let y = slot;
    for (const [rowId, height] of rows) {
      if (rowId === id) return y;
      y += height;
    }
    throw new Error(`no row ${id}`);
  };

  // getBoundingClientRect().top for a row, in viewport coordinates.
  const screenTop = (id: string) => CONTAINER_TOP + offsetOf(id) - top;
  // What the hook records for its anchor after a commit.
  const measure = (id: string) => anchorOffset(screenTop(id), CONTAINER_TOP, top);

  return {
    get scrollTop() {
      return top;
    },
    screenTop,
    measure,
    scrollBy: (delta: number) => {
      top += delta;
    },
    /** Older rows arriving at the top of the list. */
    prepend: (older: [id: string, height: number][]) => {
      rows.unshift(...older);
    },
    /** `hasMoreAbove` flipping false unmounts the h-10 sentinel. */
    dropSlot: () => {
      slot = 0;
    },
  };
}

// The measurement has to be scrollTop-independent, otherwise applying the
// compensation would change the very number the next correction is based on.
test("a row's recorded offset does not move when the container scrolls", () => {
  const list = messageList([["m1", 60], ["m2", 90]], 40, 0);

  const before = list.measure("m2");
  list.scrollBy(35);

  assert.equal(list.measure("m2"), before);
});

// The repro: reading history mid-list, an older page loads and is prepended
// above the viewport. Without compensation every visible row jumps down by the
// height of the new page.
test("a page prepended above the viewport keeps the read position", () => {
  const list = messageList([["m3", 60], ["m4", 80], ["m5", 80]], 40, 500);
  const anchor: ScrollAnchor = { id: "m3", offset: list.measure("m3") };
  const pinned = list.screenTop("m3");

  list.prepend([["m1", 70], ["m2", 70]]);

  list.scrollBy(scrollAnchorDelta(anchor, list.measure("m3")));

  assert.equal(list.scrollTop, 640, "scrollTop absorbs the 140px prepended above");
  assert.equal(list.screenTop("m3"), pinned, "the anchored row has not moved");
  assert.equal(list.screenTop("m5"), pinned + 60 + 80, "nor has anything below it");
});

// The second repro: the oldest page is loaded, `hasMoreAbove` flips false, and
// the load-older slot above the first message is removed — 40px of height gone
// above the anchor.
test("the load-older slot disappearing keeps the read position", () => {
  const list = messageList([["m1", 70], ["m2", 70], ["m3", 60]], 40, 300);
  const anchor: ScrollAnchor = { id: "m1", offset: list.measure("m1") };
  const pinned = list.screenTop("m1");

  list.dropSlot();

  list.scrollBy(scrollAnchorDelta(anchor, list.measure("m1")));

  assert.equal(list.scrollTop, 260, "scrollTop gives back the 40px slot");
  assert.equal(list.screenTop("m1"), pinned, "the first message has not moved");
  assert.equal(list.screenTop("m3"), pinned + 70 + 70, "nor has anything below it");
});

// Switching communities can unmount the anchored row entirely. A missing
// anchor must not be read as a huge negative delta that scrolls the new
// conversation to the top.
test("an anchor that is no longer in the list corrects nothing", () => {
  const list = messageList([["n1", 70], ["n2", 70]], 0, 600);
  const pinned = list.screenTop("n2");

  // The previous anchor (from the old community) is gone: measure returns null.
  list.scrollBy(scrollAnchorDelta({ id: "m1", offset: 40 }, null));

  assert.equal(list.scrollTop, 600);
  assert.equal(list.screenTop("n2"), pinned);
});

// Before the first commit there is nothing to preserve, so the mechanism stays
// out of the way of useScrollAndUnread's initial placement.
test("no anchor recorded yet means no correction", () => {
  assert.equal(scrollAnchorDelta(null, 1_000), 0);
  assert.equal(scrollAnchorDelta(undefined, 1_000), 0);
});
