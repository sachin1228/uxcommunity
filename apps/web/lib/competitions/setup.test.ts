import assert from "node:assert/strict";
import { test } from "node:test";
import { isCompetitionSchemaMissing, withCompetitionSchema } from "./setup";

test("PostgREST 'not found in schema cache' errors are recognised", () => {
  assert.equal(
    isCompetitionSchemaMissing({
      code: "PGRST205",
      message: "Could not find the table 'public.competitions' in the schema cache",
      details: null,
      hint: null,
    }),
    true,
  );

  assert.equal(
    isCompetitionSchemaMissing({
      code: "PGRST202",
      message:
        "Could not find the function public.get_competition_entries(p_competition_id, p_limit, p_offset, p_sort, p_user_id) in the schema cache",
    }),
    true,
  );
});

test("raw Postgres schema codes are recognised too", () => {
  for (const code of ["42P01", "42883", "42703"]) {
    assert.equal(isCompetitionSchemaMissing({ code, message: "whatever" }), true, code);
  }
});

test("a message-only error still explains itself", () => {
  assert.equal(
    isCompetitionSchemaMissing(new Error("relation \"competitions\" does not exist")),
    true,
  );
});

test("real failures are NOT swallowed as 'not set up'", () => {
  // A constraint violation, a permission error, a network error: all bugs that
  // must keep propagating.
  assert.equal(
    isCompetitionSchemaMissing({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }),
    false,
  );
  assert.equal(isCompetitionSchemaMissing({ code: "42501", message: "permission denied for table competitions" }), false);
  assert.equal(isCompetitionSchemaMissing(new Error("fetch failed")), false);
  assert.equal(isCompetitionSchemaMissing(null), false);
  assert.equal(isCompetitionSchemaMissing(undefined), false);
  assert.equal(isCompetitionSchemaMissing(""), false);
});

test("withCompetitionSchema reports a value instead of throwing", async () => {
  const ready = await withCompetitionSchema(async () => ({ competitions: 3 }));
  assert.deepEqual(ready, { ok: true, data: { competitions: 3 } });

  const missing = await withCompetitionSchema(async () => {
    throw { code: "PGRST205", message: "Could not find the table 'public.competitions'" };
  });
  assert.deepEqual(missing, { ok: false, setupRequired: true });

  // Anything else still rejects, so a genuine bug is never hidden behind the
  // setup notice.
  await assert.rejects(
    withCompetitionSchema(async () => {
      throw new Error("connection reset");
    }),
    /connection reset/,
  );
});
