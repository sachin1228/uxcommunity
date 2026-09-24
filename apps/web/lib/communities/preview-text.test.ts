import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { flattenPreviewText } from "./preview-text.ts";

test("flattenPreviewText collapses paragraph breaks so the clamp fills with text", () => {
  assert.equal(
    flattenPreviewText("First line here.\n\nSecond paragraph follows."),
    "First line here. Second paragraph follows.",
  );
});

test("flattenPreviewText collapses runs of spaces, tabs and blank lines", () => {
  assert.equal(flattenPreviewText("a  \t b\n\n\n  c"), "a b c");
});

test("flattenPreviewText trims leading and trailing whitespace", () => {
  assert.equal(flattenPreviewText("\n\n  padded  \n"), "padded");
  assert.equal(flattenPreviewText(""), "");
});

test("flattenPreviewText leaves already single-spaced text alone", () => {
  assert.equal(flattenPreviewText("nothing to change"), "nothing to change");
});

test("flattenPreviewText keeps non-breaking spaces from splitting words apart", () => {
  // \u00a0 is whitespace to JS regexes, so it becomes a normal space — the two
  // words stay adjacent, which is what the wrapped preview wants.
  assert.equal(flattenPreviewText("10\u00a0mm \n gap"), "10 mm gap");
});
