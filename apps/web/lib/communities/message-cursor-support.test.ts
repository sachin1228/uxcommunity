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

test("a confirmed missing function/signature is the only unsupported answer", () => {
  // PostgREST's own code for "argument names not in the schema cache".
  assert.equal(isUnknownRpcArgumentsError({ code: "PGRST202" }), true);
  // Older PostgREST versions answer a signature mismatch with 404 — but only a
  // body that names THIS function is proof.
  assert.equal(
    isUnknownRpcArgumentsError({
      code: "404",
      message:
        "Could not find the function public.get_community_message_page(p_after, p_after_id) in the schema cache",
    }),
    true,
  );
  // Some layers drop the code; the message naming this function still suffices.
  assert.equal(
    isUnknownRpcArgumentsError({
      code: null,
      message:
        "Could not find the function public.get_community_message_page(p_community_id) in the schema cache",
    }),
    true,
  );
});

test("an unrelated 404 is never proof the cursor arguments are unsupported", () => {
  // A bare 404 (a missing route, a proxy error) carries no capability signal.
  assert.equal(isUnknownRpcArgumentsError({ code: "404" }), false);
  assert.equal(isUnknownRpcArgumentsError({ code: "404", message: "Not Found" }), false);
  // A 404 naming a DIFFERENT function is a different problem entirely.
  assert.equal(
    isUnknownRpcArgumentsError({
      code: "404",
      message: "Could not find the function public.some_other_rpc(p_id) in the schema cache",
    }),
    false,
  );
});

test("an unrelated schema-cache error is not swallowed into the fallback", () => {
  // PGRST205: "Could not find the table … in the schema cache" — a real failure,
  // not a compound-cursor capability signal.
  assert.equal(
    isUnknownRpcArgumentsError({
      code: "PGRST205",
      message: "Could not find the table 'public.community_messages' in the schema cache",
    }),
    false,
  );
  assert.equal(
    isUnknownRpcArgumentsError({ message: 'relation "community_messages" does not exist' }),
    false,
  );
});

test("permission, timeout and database failures surface rather than fall back", () => {
  assert.equal(isUnknownRpcArgumentsError({ code: "42501", message: "permission denied for function" }), false);
  assert.equal(
    isUnknownRpcArgumentsError({ code: "57014", message: "canceling statement due to statement timeout" }),
    false,
  );
  assert.equal(isUnknownRpcArgumentsError({ code: "23505", message: "duplicate key value" }), false);
  assert.equal(isUnknownRpcArgumentsError({ code: "08006", message: "connection failure" }), false);
  assert.equal(isUnknownRpcArgumentsError({ code: "42P01", message: "relation does not exist" }), false);
  assert.equal(isUnknownRpcArgumentsError(new Error("network down")), false);
  assert.equal(isUnknownRpcArgumentsError(null), false);
  assert.equal(isUnknownRpcArgumentsError(undefined), false);
  assert.equal(isUnknownRpcArgumentsError("nope"), false);
});
