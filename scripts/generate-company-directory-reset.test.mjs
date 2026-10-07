#!/usr/bin/env node

/**
 * Tests for the company-directory reset operation.
 *
 *   node --test scripts/generate-company-directory-reset.test.mjs
 *
 * The SQL is exercised against a real database by
 * `supabase/tests/company_directory_seed_retirement.test.sql`. What belongs here
 * is the generated file itself: that it is derived from the seed layer rather
 * than typed out, that regenerating it is a no-op, that it contains no statement
 * capable of removing something the seed did not create, that it is NOT a
 * migration people can apply by accident, and that it refuses to delete anything
 * while a seeded company is still referenced by application data.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadSeedEntities, resetSql } from "./generate-company-directory-reset.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "supabase/reset/company_directory_seed_reset.sql");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const SEED = loadSeedEntities();
const COMMITTED = readFileSync(OUT_PATH, "utf8");
/**
 * The operation with its comments stripped. The checks about destructive
 * statements and about `verified` have to run against what EXECUTES: the header
 * says "no truncate, no drop table" in prose, and prose is not a statement.
 */
const CODE = COMMITTED.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("the committed operation is exactly what the generator produces", () => {
  assert.equal(COMMITTED, resetSql(SEED));
  assert.equal(SEED.length, 4574, "the seed layer is 4,574 entries");
});

test("it is not a migration, and only the curated seed writes directory rows", () => {
  // The reset file lives outside supabase/migrations/, so `db reset` never
  // applies it: no migration runs it, and it removes only the RETIRED v1
  // bootstrap rows, which no current migration writes.
  //
  // One migration DOES seed rows — the curated MNC list
  // (20261007130000_company_directory_mnc_seed.sql) — and it is the single
  // sanctioned exception: the directory would otherwise be an empty box until
  // the 500k import exists. This test keeps the guard by naming it: any OTHER
  // migration that starts writing directory rows has to be a deliberate change.
  assert.ok(!OUT_PATH.includes("supabase/migrations/"), "the reset is not under migrations");

  const seeders = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => readFileSync(join(MIGRATIONS, file), "utf8").includes("insert into _mnc_seed"));
  assert.deepEqual(
    seeders,
    ["20261007130000_company_directory_mnc_seed.sql"],
    "only the curated MNC seed writes directory rows from a migration"
  );

  const offenders = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => file !== "20261007130000_company_directory_mnc_seed.sql")
    .filter((file) => {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8");
      // A top-level (column 0) insert is a seed. The member-facing confirm flow
      // inserts companies from INSIDE a function body — indented, and always
      // with `created_by` — which is a write a member caused, not a seed.
      return /^insert into public\.(companies|company_domains)/m.test(sql) || /insert into _company_directory/.test(sql);
    });
  assert.deepEqual(offenders, [], "no other migration writes company or domain rows when it is applied");
});

test("applying the file removes nothing: the transition takes an explicit call", () => {
  assert.doesNotMatch(
    CODE,
    /select \* into v_counts from public\.retire_company_directory_seed/,
    "the operation must not call itself when it is applied"
  );
  assert.match(COMMITTED, /node scripts\/reset-company-directory-seed\.mjs/);
});

test("it refuses to run before the schema it plans against exists", () => {
  assert.match(COMMITTED, /message = 'seed_reset_needs_stewardship_schema'/);
  assert.match(COMMITTED, /apply 20260929150000_company_domain_stewardship\.sql/);
});

test("it records the seed's own (name, domain) list, and lets the database make the slug", () => {
  assert.match(COMMITTED, /insert into public\.company_directory_seed_retired \(name, domain, slug\)/);
  assert.match(COMMITTED, /select seed\.name, seed\.domain, public\.company_slugify\(seed\.name\)/);
  // The slug is never a literal in this file: the database's own immutable
  // function is what decides what a seed company's slug was.
  assert.doesNotMatch(COMMITTED, /\('[^']*', '[^']*', '[a-z0-9-]+'\),/);
});

test("every seed entry is addressed, and nothing else is", () => {
  // Greedy on the name: names really do contain commas ("Bennett, Coleman &
  // Co."), so the split is at the LAST "', '" on the line, not the first.
  const listed = [...COMMITTED.matchAll(/^ {4}\('(.*)', '(.*)'\),?$/gm)].map((match) => ({
    name: match[1].replace(/''/g, "'"),
    domain: match[2].replace(/''/g, "'")
  }));
  assert.equal(listed.length, SEED.length);
  assert.deepEqual(
    listed.map((row) => row.name).sort(),
    SEED.map((entity) => entity.name).sort()
  );
  assert.deepEqual(
    listed.map((row) => row.domain).sort(),
    SEED.map((entity) => entity.website_domain).sort()
  );
});

test("it identifies rows by the seed's slugs and by nothing a member created", () => {
  assert.match(COMMITTED, /join seeded on seeded\.slug = company\.slug/);
  assert.match(COMMITTED, /where company\.created_by is null/);
});

test("every guard is in the plan, so the SQL and the documentation cannot drift", () => {
  for (const guard of [
    "member_joined",
    "member_verification",
    "member_profile_points_at_it",
    "owns_a_verified_domain",
    "carries_observations",
    "operator_reviewed",
    "delegation_names_it",
    "claim_the_seed_did_not_write",
    "another_layer_owns_it",
    "has_a_registry_identity"
  ]) {
    assert.match(COMMITTED, new RegExp(`'${guard}'`), `the ${guard} guard is missing`);
  }
  // Aliases and relationships are directory structure, not application data:
  // they are reported as rows that go with the company, never as a reason to
  // keep it, so they must not appear in the `disposable` conjunction.
  assert.match(COMMITTED, /as aliases,/);
  assert.match(COMMITTED, /as relationships,/);
  assert.doesNotMatch(COMMITTED, /counted\.aliases = 0/);
  assert.doesNotMatch(COMMITTED, /counted\.relationships = 0/);
});

test("no unbounded destructive statement", () => {
  assert.doesNotMatch(CODE, /\btruncate\b/i);
  assert.doesNotMatch(CODE, /\bdrop table public\./i);
  assert.doesNotMatch(CODE, /\bcascade\b/i);
  // Every delete names the retirement plan as its source.
  const deletes = [...CODE.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(deletes)].sort(),
    [
      "companies",
      "company_aliases",
      "company_domain_delegations",
      "company_domain_reviews",
      "company_domains",
      "company_relationships",
      "domain_evidence"
    ].sort()
  );
  assert.equal(
    [...CODE.matchAll(/delete from public\.companies as c\n   where c\.id in \(select company_id from _seed_retirement_plan\)\n     and c\.created_by is null;/g)].length,
    1,
    "the companies delete is scoped to the plan and to rows nobody created"
  );
  for (const table of [
    "company_members",
    "company_email_verifications",
    "designer_profiles",
    "users"
  ]) {
    assert.doesNotMatch(
      CODE,
      new RegExp(`delete from public\\.${table}\\b`),
      `${table} holds application data and must never be deleted here`
    );
  }
});

test("it stops when a seeded company is still referenced by application data", () => {
  assert.match(COMMITTED, /seed_reset_retained_rows_present/);
  assert.match(COMMITTED, /if v_retained > 0 and not p_allow_retained then/);
  assert.match(COMMITTED, /p_allow_retained boolean default false/);
  // ...and the belt-and-braces refusal is still there behind it.
  assert.match(COMMITTED, /message = 'seed_retirement_would_touch_member_data'/);
});

test("it never writes verified, and never clears it", () => {
  assert.doesNotMatch(CODE, /set\s+verified/i);
  assert.doesNotMatch(CODE, /verified\s*=\s*(true|false)/i);
  assert.doesNotMatch(CODE, /verified_at\s*=/i);
});

test("the dry run is available before the transition, and is read-only", () => {
  assert.match(COMMITTED, /create or replace function public\.company_directory_seed_retirement_plan\(\)/);
  assert.match(COMMITTED, /create or replace function public\.retire_company_directory_seed\(\n  p_dry_run boolean default false,\n  p_allow_retained boolean default false\n\)/);
  assert.match(COMMITTED, /if p_dry_run then/);
  // The view depends on the plan function, so a re-apply has to drop it first —
  // otherwise a changed return type would fail on the second run.
  const viewDrop = COMMITTED.indexOf("drop view if exists public.company_directory_seed_retained");
  const functionDrop = COMMITTED.indexOf("drop function if exists public.company_directory_seed_retirement_plan()");
  const functionCreate = COMMITTED.indexOf("create or replace function public.company_directory_seed_retirement_plan()");
  assert.ok(viewDrop >= 0 && viewDrop < functionDrop && functionDrop < functionCreate, "drop order");
});

test("it is service-role only", () => {
  for (const signature of [
    "public\\.company_directory_seed_retirement_plan\\(\\)",
    "public\\.retire_company_directory_seed\\(boolean, boolean\\)"
  ]) {
    assert.match(COMMITTED, new RegExp(`revoke all on function ${signature} from public, anon, authenticated;`));
    assert.match(COMMITTED, new RegExp(`grant execute on function ${signature} to service_role;`));
  }
  assert.match(COMMITTED, /revoke all on table public\.company_directory_seed_retired from anon, authenticated;/);
  assert.match(COMMITTED, /alter table public\.company_directory_seed_retired enable row level security;/);
});

test("a name with an apostrophe survives the generator", () => {
  const sql = resetSql([
    { name: "O'Brien Ltd", website_domain: "obrien.com" },
    { name: "Plain Co", website_domain: "plain.com" }
  ]);
  assert.match(sql, /\('O''Brien Ltd', 'obrien\.com'\)/);
});

test("a seed that cannot be parsed is refused rather than half-reset", () => {
  assert.throws(
    () => resetSql([{ name: "A", website_domain: "a.com" }, { name: "B" }]),
    /without a name or a domain/
  );
  assert.throws(
    () => resetSql([{ name: "A", website_domain: "a.com" }, { name: "A", website_domain: "b.com" }]),
    /lists a name twice/
  );
  // Two names that slugify to one slug would collide on the retired record's
  // unique index, so they are refused at generation time rather than at apply
  // time, where the failure would come from Postgres with no explanation.
  assert.throws(
    () => resetSql([{ name: "Acme Inc.", website_domain: "acme.com" }, { name: "Acme, Inc.", website_domain: "acme2.com" }]),
    /both slugify to/
  );
});
