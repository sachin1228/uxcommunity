#!/usr/bin/env node

/**
 * Writes the migration that attributes the directory seed's claims.
 *
 *   node scripts/generate-company-directory-backfill.mjs [--check]
 *
 * WHY IT IS GENERATED
 *   The seed migration (20260929140000_company_directory.sql) is the only place
 *   the 4,574 seeded rows exist, so the backfill has to be derived from it
 *   rather than typed out beside it: a hand-written list would drift the first
 *   time the seed is regenerated, and a backfill that addresses the wrong rows
 *   is worse than no backfill (it would label somebody else's domain).
 *
 * WHAT IT WRITES
 *   One statement, two updates. The seeded domains become
 *   `primary_website` / `unknown` / `wikidata-p856` claims, and the companies
 *   they belong to get the same provenance. Every guard is in the statement:
 *
 *     d.source is null   a row a layer has already attributed is left alone, so
 *                        re-running the migration is a no-op
 *     not d.verified     a domain a member has PROVED is never touched: the
 *                        backfill cannot downgrade a proof, and it cannot
 *                        upgrade a claim either (nothing here sets verified)
 *     c.created_by is null  a company a member created is never re-attributed
 *
 *   The exact domain list is embedded so the statement can only ever address
 *   rows the seed itself wrote.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseSeedMigration } from "./generate-company-directory-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "supabase/migrations/20260929140000_company_directory.sql");
const OUT_PATH = join(ROOT, "supabase/migrations/20260929151000_company_directory_backfill.sql");

export function backfillSql(domains) {
  const unique = [...new Set(domains)].sort();
  if (unique.length !== domains.length) {
    throw new Error(
      `the seed lists ${domains.length} domains but only ${unique.length} are unique; ` +
        "the backfill addresses rows by domain, so duplicates would have to be understood first"
    );
  }

  const rows = unique.map((domain) => `    ('${domain}'),`);
  // The last row must not carry a comma, so the list reads as valid SQL both
  // when it has thousands of entries and when it has one.
  rows[rows.length - 1] = rows[rows.length - 1].replace(/,$/, "");

  return `-- ============================================================
-- Migration: Attribute the directory seed's domains
--
-- GENERATED FILE - do not edit by hand.
--   node scripts/generate-company-directory-backfill.mjs
--
-- WHAT THIS DOES
--   The seed migration (20260929140000) wrote one unverified claim per company
--   before the stewardship columns existed, so those rows carry no provenance.
--   This migration attributes exactly the domains the seed wrote:
--
--     domain_type         primary_website   (a website is what P856 is)
--     evidence_confidence unknown           (nobody has checked it)
--     source              wikidata-p856
--
--   The same provenance is set on the companies those claims belong to.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * it never sets verified, and never clears it: only a proof verifies a
--     domain, and a data import is not a proof;
--   * it skips any row a layer has already attributed (source is not null), so
--     re-running it changes nothing;
--   * it skips anything a member created (created_by is not null);
--   * it deletes nothing, and does not touch memberships or profiles.
--
-- ORDER
--   Runs after 20260929150000, which added the columns it writes.
-- ============================================================

with seeded(domain) as (
  values
${rows.join("\n")}
),
attributed as (
  update public.company_domains as d
  set domain_type = 'primary_website',
      evidence_confidence = 'unknown',
      source = 'wikidata-p856'
  from seeded as s
  where d.domain = s.domain
    and d.source is null
    and not d.verified
  returning d.company_id
)
update public.companies as c
set source = 'wikidata-p856',
    source_confidence = 'unknown'
where c.source is null
  and c.created_by is null
  and c.id in (select company_id from attributed);
`;
}

function main() {
  const seed = readFileSync(SEED_PATH, "utf8");
  const entities = parseSeedMigration(seed);
  const domains = entities.map((entity) => entity.website_domain).filter(Boolean);
  const sql = backfillSql(domains);

  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT_PATH, "utf8");
    if (current !== sql) {
      console.error(
        "the committed backfill migration does not match the seed; " +
          "run `node scripts/generate-company-directory-backfill.mjs` and commit the result"
      );
      process.exitCode = 1;
      return;
    }
    console.log(`backfill migration matches the seed (${domains.length} domains)`);
    return;
  }

  writeFileSync(OUT_PATH, sql);
  console.log(`Wrote ${OUT_PATH.replace(`${ROOT}/`, "")} (${domains.length} domains, ${sql.length} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
