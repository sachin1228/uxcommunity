import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollChatToBottom, type ScrollableLike } from "./chatUtils";

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
