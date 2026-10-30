import test from "node:test";
import assert from "node:assert/strict";

import { pgEnvFromUrl } from "./postgres.mjs";
import { parseArgs } from "./args.mjs";

test("a connection string becomes libpq environment variables", () => {
  const env = pgEnvFromUrl(
    "postgresql://postgres:p%40ss@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
  );
  assert.equal(env.PGHOST, "aws-0-ap-southeast-2.pooler.supabase.com");
  assert.equal(env.PGPORT, "5432");
  assert.equal(env.PGUSER, "postgres");
  assert.equal(env.PGDATABASE, "postgres");
  // Percent-encoded passwords must be decoded, or the connection fails.
  assert.equal(env.PGPASSWORD, "p@ss");
  assert.equal(env.PGAPPNAME, "uxcommunity-backup");
});

test("defaults are applied when the URL omits port, user or database", () => {
  const env = pgEnvFromUrl("postgresql://db.example");
  assert.equal(env.PGPORT, "5432");
  assert.equal(env.PGDATABASE, "postgres");
  assert.equal(env.PGUSER, "postgres");
  assert.equal(env.PGPASSWORD, undefined);
});

test("caller-supplied libpq settings are carried through", () => {
  const env = pgEnvFromUrl("postgresql://u@h/d", { PGSSLMODE: "require", PGCONNECT_TIMEOUT: "5" });
  assert.equal(env.PGSSLMODE, "require");
  assert.equal(env.PGCONNECT_TIMEOUT, "5");
});

test("argument parser understands values, equals forms and flags", () => {
  const parsed = parseArgs(["--target-url", "postgres://x", "--latest", "--jobs=4"], {
    known: ["target-url", "latest", "jobs"],
    flags: ["latest"],
  });
  assert.equal(parsed["target-url"], "postgres://x");
  assert.equal(parsed.latest, true);
  assert.equal(parsed.jobs, "4");
});

test("argument parser refuses unknown options instead of ignoring them", () => {
  // A typo must never silently fall back to a default (for example the
  // production target in restore-postgres.mjs).
  assert.throws(
    () => parseArgs(["--targt-url", "x"], { known: ["target-url"], flags: [] }),
    /Unknown option --targt-url/,
  );
  assert.throws(
    () => parseArgs(["--target-url"], { known: ["target-url"], flags: [] }),
    /needs a value/,
  );
  assert.throws(() => parseArgs(["--latest=yes"], { known: ["latest"], flags: ["latest"] }), /takes no value/);
});

test("flags default to false so callers can branch on them safely", () => {
  const parsed = parseArgs([], { known: ["latest"], flags: ["latest"] });
  assert.equal(parsed.latest, false);
});
