import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fmtEventWhen,
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

// ─── Event "when" line ────────────────────────────────────────────────────

// The created-event card's second line reads like the design reference:
// weekday, month, day, then the start time.
test("an event's start reads as 'Thu, Oct 1, 1:30 AM'", () => {
  // 2026-10-01T01:30 local time.
  const iso = new Date(2026, 9, 1, 1, 30).toISOString();

  assert.equal(fmtEventWhen(iso), "Thu, Oct 1, 1:30 AM");
});

// Rows without a usable date must drop the line rather than print junk.
test("an unusable event date renders as empty", () => {
  assert.equal(fmtEventWhen("not-a-date"), "");
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
