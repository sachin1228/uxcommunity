import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { detectMentionTrigger, findMentionOccurrence, resolveMentionsFromText, splitContentByMentions } from "./mentions.ts";

test("detectMentionTrigger finds an @token at the caret", () => {
  assert.deepEqual(detectMentionTrigger("hello @pri", 10), {
    start: 6,
    query: "pri",
  });
  assert.deepEqual(detectMentionTrigger("@", 1), { start: 0, query: "" });
  assert.deepEqual(detectMentionTrigger("hey @Sar", 8), {
    start: 4,
    query: "Sar",
  });
});

test("detectMentionTrigger handles unicode and punctuation in names", () => {
  assert.deepEqual(detectMentionTrigger("cc @प्रिया", 10), {
    start: 3,
    query: "प्रिया",
  });
  assert.deepEqual(detectMentionTrigger("cc @Anne-Marie", 14), {
    start: 3,
    query: "Anne-Marie",
  });
});

test("detectMentionTrigger returns null when no token is under the caret", () => {
  // '@' glued to a word = email/username
  assert.equal(detectMentionTrigger("mail me@x", 10), null);
  assert.equal(detectMentionTrigger("plain text", 5), null);
  // caret before the token
  assert.equal(detectMentionTrigger("hi @pri", 3), null);
  // whitespace ended the token
  assert.equal(detectMentionTrigger("hi @pri ", 8), null);
  // not directly after the query
  assert.equal(detectMentionTrigger("hi @pri x", 9), null);
});

test("findMentionOccurrence only matches mention boundaries", () => {
  assert.equal(findMentionOccurrence("hello @Priya!", "@Priya"), 6);
  // case-insensitive
  assert.equal(findMentionOccurrence("hello @priya!", "@Priya"), 6);
  // word glued before -> not a mention
  assert.equal(findMentionOccurrence("foo@Priya hello", "@Priya"), -1);
  // name is only a prefix of a bigger token -> not a mention
  assert.equal(findMentionOccurrence("hello @Priyanka", "@Priya"), -1);
  // punctuation after the name is fine
  assert.equal(findMentionOccurrence("hey @Priya, done", "@Priya"), 4);
});

test("resolveMentionsFromText keeps only mentions still present in content", () => {
  const registry = [
    { user_id: "u1", name: "Priya Sharma" },
    { user_id: "u2", name: "Aman" },
    { user_id: "u3", name: "Riya" },
  ];
  assert.deepEqual(
    resolveMentionsFromText("cc @Priya Sharma and @aman thanks", registry),
    [
      { user_id: "u1", name: "Priya Sharma" },
      { user_id: "u2", name: "Aman" },
    ],
  );
  // Mention was deleted from the text -> dropped. Registry entries never
  // typed again (e.g. stale from a previous message) stay dropped.
  assert.deepEqual(resolveMentionsFromText("just @Aman here", registry), [
    { user_id: "u2", name: "Aman" },
  ]);
  // "@Riya" matches "Riya" but not "@Priya" prefix overlap on render is
  // handled by longest-first in the splitter; resolution is per entry.
  assert.deepEqual(resolveMentionsFromText("hi @riya", registry), [
    { user_id: "u3", name: "Riya" },
  ]);
});

test("splitContentByMentions produces text and mention segments", () => {
  const mentions = [
    { user_id: "u1", name: "Priya Sharma" },
    { user_id: "u2", name: "Aman" },
  ];
  const segments = splitContentByMentions(
    "cc @Priya Sharma, and @Aman — let's go",
    mentions,
  );
  assert.deepEqual(segments, [
    { text: "cc ", mention: null },
    { text: "@Priya Sharma", mention: mentions[0] },
    { text: ", and ", mention: null },
    { text: "@Aman", mention: mentions[1] },
    { text: " — let's go", mention: null },
  ]);
});

test("splitContentByMentions prefers the longest matching name", () => {
  const mentions = [
    { user_id: "u1", name: "Sara Khan" },
    { user_id: "u2", name: "Sara" },
  ];
  const segments = splitContentByMentions("hey @Sara Khan!", mentions);
  assert.deepEqual(segments, [
    { text: "hey ", mention: null },
    { text: "@Sara Khan", mention: mentions[0] },
    { text: "!", mention: null },
  ]);
});

test("splitContentByMentions leaves non-mentioned @words as plain text", () => {
  const mentions = [{ user_id: "u1", name: "Nina" }];
  const segments = splitContentByMentions(
    "email me@nina.dev or @nina now",
    mentions,
  );
  // "me@nina.dev" is not a mention; "@nina" (word boundary + end) is.
  assert.deepEqual(segments, [
    { text: "email me@nina.dev or ", mention: null },
    { text: "@nina", mention: mentions[0] },
    { text: " now", mention: null },
  ]);
});

test("splitContentByMentions returns a single segment for no mentions", () => {
  assert.deepEqual(splitContentByMentions("plain text", []), [
    { text: "plain text", mention: null },
  ]);
  assert.deepEqual(splitContentByMentions("", []), []);
});
