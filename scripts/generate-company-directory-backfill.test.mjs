/**
 * Tests for scripts/generate-company-directory-backfill.mjs.
 *
 * The backfill addresses rows BY DOMAIN, so the two ways it can go wrong are
 * both silent: addressing a domain the seed never wrote (labelling somebody
 * else's company), and claiming to attribute something it cannot (writing
 * `verified`). Both are pinned here, plus the property that the committed file
 * is exactly what the generator produces — a hand-edited backfill is a
 * backfill nobody can reproduce.
 *
 * Run: node --test scripts/generate-company-directory-backfill.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { backfillSql } from "./generate-company-directory-backfill.mjs";
import { parseSeedMigration } from "./generate-company-directory-v2.mjs";

const SEED_URL = new URL("../supabase/migrations/20260929140000_company_directory.sql", import.meta.url);
const BACKFILL_URL = new URL("../supabase/migrations/20260929151000_company_directory_backfill.sql", import.meta.url);

const seedEntities = parseSeedMigration(readFileSync(SEED_URL, "utf8"));
const seedDomains = [...new Set(seedEntities.map((entity) => entity.website_domain))].sort();
const committed = readFileSync(BACKFILL_URL, "utf8");

/** `('a.com'),('b.com')` → ["a.com", "b.com"] */
function domainsIn(sql) {
  return [...sql.matchAll(/^ {4}\('([^']+)'\)/gm)].map((match) => match[1]);
}

test("the committed migration is exactly what the generator produces", () => {
  assert.equal(committed, backfillSql(seedDomains));
  assert.ok(committed.length > 100_000, "the real seed is thousands of domains");
});

test("the backfill addresses every seeded domain and nothing else", () => {
  const listed = domainsIn(committed).sort();
  assert.deepEqual(listed, seedDomains);
  assert.equal(seedDomains.length, 4574);
});

test("it never writes verified, so no import can mark a domain proved", () => {
  // `not d.verified` may appear as a guard; `verified = ...` may not appear at
  // all, which is what makes "data never verifies" a property of the file.
  assert.match(committed, /and not d\.verified/);
  assert.doesNotMatch(committed, /verified\s*=/);
});

test("it only touches rows nobody has attributed, and nothing a member created", () => {
  assert.match(committed, /and d\.source is null/);
  assert.match(committed, /and c\.created_by is null/);
  // Deleting is how a backfill loses data it did not mean to touch.
  assert.doesNotMatch(committed, /delete from/i);
  assert.doesNotMatch(committed, /drop table/i);
});

test("it attributes the claim AND the company, in one statement", () => {
  assert.match(committed, /with seeded\(domain\) as \(/);
  assert.match(committed, /update public\.company_domains/);
  assert.match(committed, /update public\.companies/);
  assert.match(committed, /source = 'wikidata-p856'/);
});

test("nothing in it can downgrade a proof, however often it runs", () => {
  // The three ways a scheduled backfill could take a verified domain away:
  // un-verifying the row, deleting it, or emptying the table first. The whole
  // file is checked, so a new statement cannot slip one in unnoticed.
  assert.doesNotMatch(committed, /verified\s*=\s*false/i);
  assert.doesNotMatch(committed, /set\s+verified/i);
  assert.doesNotMatch(committed, /\bdelete\b/i);
  assert.doesNotMatch(committed, /\btruncate\b/i);
  assert.doesNotMatch(committed, /\bdrop\b/i);
  assert.doesNotMatch(committed, /verified_at\s*=/i);
  // And it is guarded to unverified rows and unattributed rows only, which is
  // what makes a second, third and hundredth run a no-op.
  assert.match(committed, /and not d\.verified/);
  assert.match(committed, /and d\.source is null/);
});

test("a duplicate domain in the seed is refused, not papered over", () => {
  // The statement addresses rows by domain, so duplicates would attribute two
  // companies from one row without saying which.
  assert.throws(() => backfillSql(["acme.com", "acme.com"]), /duplicates/);
});

test("a single-domain list is still valid SQL", () => {
  const sql = backfillSql(["acme.com"]);
  assert.match(sql, /^ {4}\('acme\.com'\)$/m);
  assert.doesNotMatch(sql, /\('acme\.com'\),/);
});

test("the generated file is deterministic", () => {
  assert.equal(backfillSql(seedDomains), backfillSql([...seedDomains].reverse()));
});
