import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPOUND_CURSOR_RETRY_MS,
  createCompoundCursorSupport,
  isUnknownRpcArgumentsError,
} from "./message-cursor-support";

// ─── Deployment compatibility ───────────────────────────────────────────────
//
// Migrations in this project are applied by hand, so the web build can run
// against a database that still has the seven-argument
// get_community_message_page for a while. Sending the cursor id halves to that
// function answers PGRST202, and the tracker is what turns "paid once per
// retry window" into "paid once per request".

test("the optimistic default assumes the migration is applied", () => {
  const support = createCompoundCursorSupport();
  assert.equal(support.supportsCompoundCursor(), true);
});

test("an observed PGRST202 suppresses compound calls for the retry window", () => {
  let now = 1_000;
  const support = createCompoundCursorSupport({ now: () => now });

  support.noteUnsupported();
  assert.equal(support.supportsCompoundCursor(), false);

  // Still inside the window (one millisecond short).
  now += COMPOUND_CURSOR_RETRY_MS - 1;
  assert.equal(support.supportsCompoundCursor(), false);
});

test("the window expiring retries the compound call without a restart", () => {
  let now = 1_000;
  const support = createCompoundCursorSupport({ now: () => now });

  support.noteUnsupported();
  assert.equal(support.supportsCompoundCursor(), false);

  // The migration lands moments later: the next request past the window tries
  // the compound call again instead of staying on the fallback forever.
  now += COMPOUND_CURSOR_RETRY_MS;
  assert.equal(support.supportsCompoundCursor(), true);
});

test("a positive observation clears the suppression immediately", () => {
  let now = 1_000;
  const support = createCompoundCursorSupport({ now: () => now });

  support.noteUnsupported();
  assert.equal(support.supportsCompoundCursor(), false);
  support.noteSupported();
  assert.equal(support.supportsCompoundCursor(), true);
});

test("only a missing-function answer counts as unsupported", () => {
  // PostgREST's own code for "argument names not in the schema cache".
  assert.equal(isUnknownRpcArgumentsError({ code: "PGRST202" }), true);
  // Older versions answer a signature mismatch with a plain 404.
  assert.equal(isUnknownRpcArgumentsError({ code: "404" }), true);
  // The message is the belt to the code's braces.
  assert.equal(
    isUnknownRpcArgumentsError({ code: "PGRST100", message: "Could not find the function public.x in the schema cache" }),
    true,
  );

  // Everything else is a real failure and must surface as a 500 rather than
  // being swallowed into the timestamp-only fallback.
  assert.equal(isUnknownRpcArgumentsError({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isUnknownRpcArgumentsError({ code: "42P01" }), false);
  assert.equal(isUnknownRpcArgumentsError(new Error("network down")), false);
  assert.equal(isUnknownRpcArgumentsError(null), false);
  assert.equal(isUnknownRpcArgumentsError(undefined), false);
});
