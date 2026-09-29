#!/usr/bin/env node

/**
 * Tests for the migration that retires the seeded company directory.
 *
 *   node --test scripts/generate-company-directory-removal.test.mjs
 *
 * The SQL is exercised against a real database by
 * `supabase/tests/company_directory_seed_retirement.test.sql` (42 assertions:
 * identification, every guard, idempotency, dry run, grants). What belongs here
 * is the generated file itself: that it is derived from the seed rather than
 * typed out, that regenerating it is a no-op, and that it contains no statement
 * capable of removing something the seed did not create.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { retirementSql } from "./generate-company-directory-removal.mjs";
import { parseSeedMigration } from "./generate-company-directory-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "supabase/migrations/20260929140000_company_directory.sql");
const OUT_PATH = join(ROOT, "supabase/migrations/20260929153000_company_directory_seed_retirement.sql");
const SEED = parseSeedMigration(readFileSync(SEED_PATH, "utf8"));
const COMMITTED = readFileSync(OUT_PATH, "utf8");
/**
 * The migration with its comments stripped. The checks about destructive
 * statements and about `verified` have to run against what EXECUTES: the header
 * says "no truncate, no drop table" in prose, and prose is not a statement.
 */
const CODE = COMMITTED.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("the committed migration is exactly what the generator produces", () => {
  assert.equal(COMMITTED, retirementSql(SEED));
  assert.ok(SEED.length === 4574, "the seed is 4,574 entries");
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
});

test("no unbounded destructive statement", () => {
  assert.doesNotMatch(CODE, /\btruncate\b/i);
  assert.doesNotMatch(CODE, /\bdrop table public\./i);
  assert.doesNotMatch(CODE, /\bcascade\b/i);
  // Every delete names the retirement plan as its source.
  const deletes = [...CODE.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(deletes, [
    "company_domains",
    "domain_evidence",
    "company_aliases",
    "company_relationships",
    "company_domain_delegations",
    "company_domain_reviews",
    "companies"
  ]);
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

test("it refuses the whole transition if a disposable row turns out to be referenced", () => {
  assert.match(COMMITTED, /raise exception using errcode = 'P0001', message = 'seed_retirement_would_touch_member_data'/);
});

test("it never writes verified, and never clears it", () => {
  assert.doesNotMatch(CODE, /set\s+verified/i);
  assert.doesNotMatch(CODE, /verified\s*=\s*(true|false)/i);
  assert.doesNotMatch(CODE, /verified_at\s*=/i);
});

test("the dry run is available before the transition, and is read-only", () => {
  assert.match(COMMITTED, /create or replace function public\.company_directory_seed_retirement_plan\(\)/);
  assert.match(COMMITTED, /create or replace function public\.retire_company_directory_seed\(\n  p_dry_run boolean default false\n\)/);
  assert.match(COMMITTED, /if p_dry_run then/);
});

test("it is service-role only", () => {
  for (const signature of [
    "public\\.company_directory_seed_retirement_plan\\(\\)",
    "public\\.retire_company_directory_seed\\(boolean\\)"
  ]) {
    assert.match(COMMITTED, new RegExp(`revoke all on function ${signature} from public, anon, authenticated;`));
    assert.match(COMMITTED, new RegExp(`grant execute on function ${signature} to service_role;`));
  }
  assert.match(COMMITTED, /revoke all on table public\.company_directory_seed_retired from anon, authenticated;/);
  assert.match(COMMITTED, /alter table public\.company_directory_seed_retired enable row level security;/);
});

test("a name with an apostrophe survives the generator", () => {
  const sql = retirementSql([
    { name: "O'Brien Ltd", website_domain: "obrien.com" },
    { name: "Plain Co", website_domain: "plain.com" }
  ]);
  assert.match(sql, /\('O''Brien Ltd', 'obrien\.com'\)/);
});

test("a seed that cannot be parsed is refused rather than half-retired", () => {
  assert.throws(
    () => retirementSql([{ name: "A", website_domain: "a.com" }, { name: "B" }]),
    /names and .* domains/
  );
  assert.throws(
    () => retirementSql([{ name: "A", website_domain: "a.com" }, { name: "A", website_domain: "b.com" }]),
    /lists a name twice/
  );
});
