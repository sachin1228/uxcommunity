#!/usr/bin/env node

/**
 * Tests for the curated MNC company-directory seed.
 *
 *   node --test scripts/generate-company-directory-mnc-seed.test.mjs
 *
 * The SQL is exercised against a real database by
 * `supabase/tests/company_directory_mnc_seed.test.sql` and
 * `supabase/tests/company_directory_design_first.test.sql`. What belongs here is
 * the generated file and the source list: that the migration is derived from
 * data/company-directory/mnc-companies.json rather than typed out, that the list
 * is big enough and internally consistent (unique names, domains and slugs), and
 * that the SQL contains nothing capable of destroying a member's data.
 *
 * The same source list holds the `featured` design block, and THAT migration
 * (20261007150000_company_directory_design_first.sql) is hand-written, because
 * most of it is a `search_companies` rewrite that has to stay readable. The
 * tests at the bottom of this file are what keeps the hand-written list in step
 * with the JSON: they parse the migration and compare it to `featured`, name by
 * name and position by position.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOMAIN_RE,
  loadFeatured,
  loadMncCompanies,
  seedSql,
} from "./generate-company-directory-mnc-seed.mjs";
import { slugify } from "./generate-company-directory-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "supabase/migrations/20261007130000_company_directory_mnc_seed.sql");
const FEATURED_PATH = join(
  ROOT,
  "supabase/migrations/20261007150000_company_directory_design_first.sql"
);

const COMPANIES = loadMncCompanies();
const COMMITTED = readFileSync(OUT_PATH, "utf8");
const FEATURED = loadFeatured();
const FEATURED_SQL = readFileSync(FEATURED_PATH, "utf8");
/** The design-first migration with its comments stripped: the checks about
 * `verified` have to run against what EXECUTES, not against prose. */
const FEATURED_CODE = FEATURED_SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
/** The migration with its comments stripped: the static checks must see code. */
const CODE = COMMITTED.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("the committed migration is exactly what the generator produces", () => {
  assert.equal(COMMITTED, seedSql(COMPANIES));
});

test("the list is a usable directory: at least 500 companies", () => {
  assert.ok(COMPANIES.length >= 500, `expected >= 500 companies, got ${COMPANIES.length}`);
});

test("names, domains and slugs are unique and syntactically valid", () => {
  const names = new Set();
  const domains = new Set();
  const slugs = new Set();
  for (const entry of COMPANIES) {
    assert.ok(entry.name.trim().length >= 1 && entry.name.trim().length <= 120, entry.name);
    assert.match(entry.domain, DOMAIN_RE, `${entry.name}: ${entry.domain}`);
    assert.ok(!names.has(entry.name.toLowerCase()), `duplicate name ${entry.name}`);
    assert.ok(!domains.has(entry.domain), `duplicate domain ${entry.domain}`);
    assert.ok(!slugs.has(slugify(entry.name)), `duplicate slug ${slugify(entry.name)}`);
    names.add(entry.name.toLowerCase());
    domains.add(entry.domain);
    slugs.add(slugify(entry.name));
  }
});

test("no consumer mailbox domain is offered as an employer", () => {
  const consumer = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "proton.me", "mail.ru", "qq.com",
  ]);
  assert.deepEqual(
    COMPANIES.map((entry) => entry.domain).filter((domain) => consumer.has(domain)),
    []
  );
});

test("the seed never writes a proof: every hint is unverified", () => {
  assert.doesNotMatch(CODE, /verified\s*=\s*true/i);
  assert.doesNotMatch(CODE, /set\s+verified/i);
  assert.doesNotMatch(CODE, /verified_at\s*=/i);
});

test("the insert is idempotent and never overwrites an existing row", () => {
  assert.match(CODE, /on conflict \(slug\) do nothing/);
  assert.match(CODE, /on conflict \(company_id, domain\) do nothing/);
});

test("the only rows it removes are the one-character test companies", () => {
  const deletes = [...CODE.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(deletes)].sort(), ["companies"]);
  assert.match(CODE, /delete from public\.companies\s+where slug ~ '\^\[a-z0-9\]\$'/);

  assert.doesNotMatch(CODE, /\btruncate\b/i);
  assert.doesNotMatch(CODE, /\bdrop table public\./i);
  assert.doesNotMatch(CODE, /\bcascade\b/i);
  for (const table of ["company_members", "company_email_verifications", "designer_profiles", "users"]) {
    assert.doesNotMatch(CODE, new RegExp(`delete from public\\.${table}\\b`), `${table} must never be deleted`);
  }
});

test("it refuses to run before the schema it writes into exists", () => {
  assert.match(COMMITTED, /message = 'mnc_seed_needs_stewardship_schema'/);
  assert.match(COMMITTED, /apply 20260929120000_company_verified_domains\.sql/);
});

test("a name with an apostrophe survives the generator", () => {
  const sql = seedSql([{ name: "O'Brien Ltd", domain: "obrien.com", country: "GB", industry: "x" }]);
  assert.match(sql, /\('O''Brien Ltd', 'obrien\.com'/);
});

// ─── The design-first block ─────────────────────────────────
//
// `featured` decides what the picker's first screen (an empty search box) shows.
// The migration that applies it is hand-written, so these tests are the only
// thing standing between the JSON and a migration that marks the wrong
// companies, or the right ones in the wrong order.

test("the design block fills a first screen without becoming a second directory", () => {
  assert.ok(
    FEATURED.length >= 8,
    `a design block shorter than the ${8} hits the picker asks for would leave the first screen half empty`
  );
  assert.ok(FEATURED.length <= 60, `the block should stay curated, got ${FEATURED.length}`);
  // The picker opens on the first entry, so the list's head is a product
  // decision, not an alphabetical accident.
  assert.equal(FEATURED[0], "Figma", "the block leads with the design tool designers ask for first");
});

test("the migration marks exactly the featured companies, in exactly that order", () => {
  const from = FEATURED_SQL.indexOf("insert into _design_first (name, rank) values");
  assert.ok(from > 0, "the migration is expected to list the block as (name, rank)");
  const block = FEATURED_SQL.slice(from, FEATURED_SQL.indexOf(";", from));
  const rows = [...block.matchAll(/^[ \t]*\('((?:[^']|'')*)', (\d+)\),?$/gm)].map((match) => ({
    name: match[1].replace(/''/g, "'"),
    rank: Number(match[2])
  }));

  assert.deepEqual(
    rows.map((row) => row.name),
    FEATURED,
    "the migration's design block is the JSON's `featured` array, in order"
  );
  assert.deepEqual(
    rows.map((row) => row.rank),
    FEATURED.map((_, index) => index + 1),
    "the ranks are 1..N with no gaps, so no two featured rows share a position"
  );
});

test("the curation touches nothing the import derives", () => {
  assert.match(FEATURED_CODE, /add column if not exists featured_rank integer/);
  assert.match(
    FEATURED_CODE,
    /create index if not exists companies_featured_rank_idx\s+on public\.companies \(featured_rank\)\s+where featured_rank is not null/,
    "the featured arm is index-backed, like every other arm"
  );
  // `directory_rank` is the import's derived ordering (evidence, confidence,
  // notability). Writing a curation order into it would corrupt a meaning
  // another layer recomputes — so `featured_rank` is the only column this
  // migration ever sets, and it adds no other one.
  // (`set search_path = ''` is part of the function declaration, not a write.)
  assert.deepEqual(
    [...FEATURED_CODE.matchAll(/\bset\s+(\w+)\s*=\s*([^;]+)/gi)]
      .filter((match) => !match[2].trimStart().startsWith("''"))
      .map((match) => match[1]),
    ["featured_rank"],
    "featured_rank is the only column the curation writes"
  );
  assert.deepEqual(
    [...FEATURED_CODE.matchAll(/add column if not exists (\w+)/gi)].map((match) => match[1]),
    ["featured_rank"],
    "the curation adds one column, not a schema of its own"
  );
});

test("the browse arm leads with the block and still walks an index", () => {
  assert.match(
    FEATURED_CODE,
    /where c\.is_active and c\.featured_rank is not null\s+order by c\.featured_rank asc\s+limit v_max/,
    "the featured arm is bounded and ordered by the curated rank"
  );
  assert.match(
    FEATURED_CODE,
    /where c\.is_active and c\.featured_rank is null\s+order by c\.name asc\s+limit v_max/,
    "the rest of the directory follows in name order"
  );
  assert.match(
    FEATURED_CODE,
    /order by b\.arm asc, b\.arm_rank asc nulls last, c\.name asc/,
    "the arms are folded back in arm order: featured first"
  );
  // Typing is not curated: the prefix and substring branches are untouched.
  assert.match(FEATURED_CODE, /if length\(v_lower\) < 3 then/);
  assert.match(FEATURED_CODE, /public\.company_aliases as a/);
});

test("the design block never writes a proof and stays service-role only", () => {
  assert.doesNotMatch(FEATURED_CODE, /verified\s*=\s*true/i);
  assert.doesNotMatch(FEATURED_CODE, /set\s+verified/i);
  assert.doesNotMatch(FEATURED_CODE, /verified_at\s*=/i);
  assert.match(
    FEATURED_SQL,
    /revoke all on function public\.search_companies\(text, integer\) from public, anon, authenticated;/
  );
  assert.match(
    FEATURED_SQL,
    /grant execute on function public\.search_companies\(text, integer\) to service_role;/
  );
  assert.doesNotMatch(FEATURED_SQL, /to (anon|authenticated);/);
});

test("it refuses to run when the schema or a featured company is missing", () => {
  assert.match(FEATURED_SQL, /message = 'design_first_needs_directory_schema'/);
  assert.match(FEATURED_SQL, /message = 'design_first_company_missing'/);
  assert.match(FEATURED_SQL, /apply 20260929120000_company_verified_domains\.sql/);
  // The match is made the way the seed made the slug, not by a literal.
  assert.match(FEATURED_CODE, /c\.slug = public\.company_slugify\(d\.name\)/);
});

test("a design block that names something else is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "mnc-featured-"));
  const write = (name, featured, companies) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        featured,
        companies: companies ?? [{ name: "Figma", domain: "figma.com" }]
      })
    );
    return path;
  };

  try {
    assert.throws(
      () => loadFeatured(write("typo", ["Figma", "Figmaa"])),
      /featured names Figmaa, which is not in `companies`/
    );
    assert.throws(
      () => loadFeatured(write("twice", ["Figma", "Figma"])),
      /featured lists Figma twice/
    );
    assert.throws(
      () => loadFeatured(write("empty-entry", ["Figma", "  "])),
      /featured entry 2 is empty/
    );
    assert.throws(() => loadFeatured(write("none", [])), /no `featured` array/);
    assert.deepEqual(loadFeatured(write("ok", ["Figma"])), ["Figma"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unusable list is refused rather than seeded", () => {
  const dir = mkdtempSync(join(tmpdir(), "mnc-seed-"));
  const write = (name, companies) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify({ companies }));
    return path;
  };

  try {
    assert.throws(
      () => loadMncCompanies(write("bad-domain", [{ name: "Ok", domain: "not a domain" }])),
      /not a registrable domain/
    );
    assert.throws(
      () => loadMncCompanies(write("dup-name", [
        { name: "Ok", domain: "ok.com" },
        { name: "ok", domain: "ok2.com" },
      ])),
      /duplicate name/
    );
    assert.throws(
      () => loadMncCompanies(write("dup-domain", [
        { name: "Ok", domain: "ok.com" },
        { name: "Other", domain: "ok.com" },
      ])),
      /also listed for/
    );
    // Two names that slugify to one slug would collide on the companies unique
    // index, and `on conflict (slug) do nothing` would silently drop the second.
    assert.throws(
      () => loadMncCompanies(write("dup-slug", [
        { name: "Acme Inc.", domain: "acme.com" },
        { name: "Acme, Inc.", domain: "acme2.com" },
      ])),
      /collides with/
    );
    assert.throws(
      () => loadMncCompanies(write("empty", [])),
      /no `companies` array/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
