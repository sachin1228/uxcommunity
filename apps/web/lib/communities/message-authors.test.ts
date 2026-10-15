/**
 * The message page's author map: what the loader will hand a message's `users`.
 *
 * The SQL side is covered by the message-page suites; what is decided here is
 * what the app does with an answer it must not trust — an un-migrated database
 * (no map at all), a key with no name, a field of the wrong type.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMessageAuthorMap } from "./message-authors";

const USER = "11111111-1111-4111-8111-111111111111";

test("a well-formed map comes back as the shape a message renders", () => {
  const authors = parseMessageAuthorMap({
    [USER]: { name: "Ada", avatar_url: "https://cdn.test/ada.png", designation: "Designer" },
  });

  assert.deepEqual(authors, {
    [USER]: { name: "Ada", avatar_url: "https://cdn.test/ada.png", designation: "Designer" },
  });
});

test("a row with no avatar or designation keeps the author, with nulls", () => {
  const authors = parseMessageAuthorMap({ [USER]: { name: "Ada" } });

  assert.deepEqual(authors, { [USER]: { name: "Ada", avatar_url: null, designation: null } });
});

test("a field of the wrong type is dropped rather than passed on", () => {
  const authors = parseMessageAuthorMap({
    [USER]: { name: "Ada", avatar_url: 42, designation: { role: "Designer" } },
  });

  assert.deepEqual(authors, { [USER]: { name: "Ada", avatar_url: null, designation: null } });
});

test("an author without a usable name is not an author", () => {
  const authors = parseMessageAuthorMap({
    [USER]: { name: "" },
    "22222222-2222-4222-8222-222222222222": { avatar_url: "https://cdn.test/x.png" },
    "33333333-3333-4333-8333-333333333333": "Ada",
  });

  assert.deepEqual(authors, {}, "a message falls back to the placeholder, not to a blank label");
});

test("an absent map is an empty map — the un-migrated database's answer", () => {
  for (const value of [null, undefined, "{}", 7, [1, 2]]) {
    assert.deepEqual(parseMessageAuthorMap(value), {});
  }
});

test("an empty page's map is empty, not undefined", () => {
  assert.deepEqual(parseMessageAuthorMap({}), {});
});
