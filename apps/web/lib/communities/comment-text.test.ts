import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { splitCommentText } from "./comment-text.ts";

test("splitCommentText leaves text without mentions in one plain segment", () => {
  assert.deepEqual(splitCommentText("nice work here"), [
    { text: "nice work here", mention: false },
  ]);
  assert.deepEqual(splitCommentText(""), []);
});

test("splitCommentText highlights a bare @token", () => {
  assert.deepEqual(splitCommentText("thanks @sachin!"), [
    { text: "thanks ", mention: false },
    { text: "@sachin", mention: true },
    { text: "!", mention: false },
  ]);
});

test("splitCommentText spans a known multi-word name", () => {
  assert.deepEqual(splitCommentText("@Vishal Gn this is good", ["Vishal Gn"]), [
    { text: "@Vishal Gn", mention: true },
    { text: " this is good", mention: false },
  ]);
});

test("splitCommentText prefers the longest known name", () => {
  assert.deepEqual(splitCommentText("cc @Sara Khan", ["Sara", "Sara Khan"]), [
    { text: "cc ", mention: false },
    { text: "@Sara Khan", mention: true },
  ]);
});

test("splitCommentText falls back to the first token of an unknown multi-word tag", () => {
  assert.deepEqual(splitCommentText("@ux community this is good"), [
    { text: "@ux", mention: true },
    { text: " community this is good", mention: false },
  ]);
});

test("splitCommentText ignores @ glued to a word (emails, usernames)", () => {
  assert.deepEqual(splitCommentText("mail me@example.com"), [
    { text: "mail me@example.com", mention: false },
  ]);
  // `@` directly after `@` is not a mention boundary either — the whole run
  // stays plain.
  assert.deepEqual(splitCommentText("@@double"), [
    { text: "@@double", mention: false },
  ]);
});

test("splitCommentText matches known names case-insensitively", () => {
  assert.deepEqual(splitCommentText("@aaditya b ok", ["Aaditya B"]), [
    { text: "@aaditya b", mention: true },
    { text: " ok", mention: false },
  ]);
});

test("splitCommentText keeps a lone @ plain", () => {
  assert.deepEqual(splitCommentText("@ alone"), [{ text: "@ alone", mention: false }]);
});
