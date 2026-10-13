import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATION_LIMIT_MESSAGES,
  creationLimitFromError,
  type CreationLimitKind,
} from "./creation-limits";

test("recognises every database limit kind", () => {
  for (const kind of Object.keys(CREATION_LIMIT_MESSAGES) as CreationLimitKind[]) {
    assert.equal(creationLimitFromError({ message: `limit:${kind}` }), kind);
    assert.ok(CREATION_LIMIT_MESSAGES[kind].length > 0);
  }
});

test("ignores messages that are not limits", () => {
  assert.equal(creationLimitFromError(null), null);
  assert.equal(creationLimitFromError(undefined), null);
  assert.equal(creationLimitFromError({}), null);
  assert.equal(creationLimitFromError({ message: null }), null);
  assert.equal(creationLimitFromError({ message: "Failed to create thread." }), null);
  assert.equal(creationLimitFromError({ message: "limit:" }), null);
  assert.equal(creationLimitFromError({ message: "limit:not_a_budget" }), null);
});

test("reads the first line and tolerates PostgREST detail lines", () => {
  assert.equal(
    creationLimitFromError({ message: "limit:posts_daily\nDETAIL: something" }),
    "posts_daily"
  );
  assert.equal(
    creationLimitFromError({ message: " limit:community_joins " }),
    "community_joins"
  );
});
