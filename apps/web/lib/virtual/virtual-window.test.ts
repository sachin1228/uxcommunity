import assert from "node:assert/strict";
import test from "node:test";

import { virtualWindow } from "./virtual-window";

const ROW = 60;

test("an empty list renders no spacers", () => {
  assert.deepEqual(virtualWindow(0, ROW, 0, 600), {
    start: 0, end: 0, topSpacer: 0, bottomSpacer: 0,
  });
});

test("the first screen renders the visible rows plus overscan", () => {
  const window = virtualWindow(100, ROW, 0, 600, 3);
  assert.equal(window.start, 0);
  assert.equal(window.end, 11 + 6);
  assert.equal(window.topSpacer, 0);
  assert.equal(window.bottomSpacer, (100 - window.end) * ROW);
});

test("scrolling keeps the visible range covered and spacers exact", () => {
  const window = virtualWindow(100, ROW, 3000, 600, 3);
  // 50 rows above the viewport, minus 3 overscan.
  assert.equal(window.start, 47);
  assert.ok(window.start * ROW <= 3000, "the slice starts above the viewport");
  assert.ok(window.end * ROW >= 3000 + 600, "the slice ends below the viewport");
  assert.equal(window.topSpacer, 47 * ROW);
  assert.equal(window.bottomSpacer, (100 - window.end) * ROW);
});

test("the end of the list clamps to itemCount", () => {
  const window = virtualWindow(20, ROW, 10_000, 600, 4);
  assert.equal(window.end, 20);
  assert.equal(window.bottomSpacer, 0);
  assert.equal(window.topSpacer, window.start * ROW);
});

test("an unmeasured viewport still renders the first overscan window", () => {
  const window = virtualWindow(5, ROW, 0, 0, 2);
  assert.equal(window.start, 0);
  assert.equal(window.end, 5);
});
