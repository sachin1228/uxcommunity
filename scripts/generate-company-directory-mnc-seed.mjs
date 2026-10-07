#!/usr/bin/env node

/**
 * Generates the curated MNC company-directory seed migration.
 *
 *   node scripts/generate-company-directory-mnc-seed.mjs          # write the migration
 *   node scripts/generate-company-directory-mnc-seed.mjs --check  # verify it is current
 *
 * WHY THIS EXISTS
 *   The directory starts EMPTY (the v1 Wikidata seed was retired; see
 *   docs/company-directory-reset.md) and the 500,000-company import is a
 *   separate, later phase. Until then the "Where do you work?" picker would be
 *   an empty box, so this file writes the reviewable, hand-curated list of the
 *   multi-national employers designers actually work for across the US, Europe
 *   and India.
 *
 * WHAT IT WRITES
 *   One `companies` row per entry and one UNVERIFIED `company_domains` hint.
 *   A hint is not a claim: it makes the company appear in the picker and lets
 *   the first member whose work email matches finish the claim through the
 *   ordinary OTP flow. `verified` is never written here.
 *
 * WHERE THE LIST LIVES
 *   data/company-directory/mnc-companies.json — the single source. Editing the
 *   SQL by hand is refused by `--check`, which the node test runs.
 *
 *   The same file also holds `featured`: the design companies the picker shows
 *   FIRST, in the order it shows them. That block is applied by a separate,
 *   hand-written migration (20261007150000_company_directory_design_first.sql)
 *   because most of that file is a `search_companies` rewrite, and a function
 *   buried in a template literal is not reviewable. `loadFeatured` validates the
 *   array here; the node test asserts the migration marks exactly it.
 *
 *   The admin page (app/admin/(protected)/companies) manages these rows at
 *   runtime through /api/admin/companies; this migration is the one-time list,
 *   and both write the same two tables, so the two stay in sync by construction.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { slugify } from "./generate-company-directory-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = join(ROOT, "data/company-directory/mnc-companies.json");
const OUT_PATH = join(ROOT, "supabase/migrations/20261007130000_company_directory_mnc_seed.sql");

/**
 * A registrable hostname. Matches the `company_domains.domain` check in
 * 20260929120000_company_verified_domains.sql so the generator refuses a row the
 * database would reject, rather than failing the migration.
 */
export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Reads and validates the curated list. Throws on anything that would make the
 * migration ambiguous or fail at apply time; exported so the test asserts the
 * same file the SQL is generated from.
 */
export function loadMncCompanies(path = DATA_PATH) {
  const source = JSON.parse(readFileSync(path, "utf8"));
  const companies = source.companies ?? [];
  if (!Array.isArray(companies) || companies.length === 0) {
    throw new Error("mnc-companies.json has no `companies` array");
  }

  const seenNames = new Map();
  const seenDomains = new Map();
  const seenSlugs = new Map();

  for (const [index, entry] of companies.entries()) {
    const where = `entry ${index + 1} (${entry?.name ?? "?"})`;
    const name = String(entry?.name ?? "").trim();
    const domain = String(entry?.domain ?? "").trim().toLowerCase();
    if (!name || name.length > 120) {
      throw new Error(`${where}: name must be 1–120 characters`);
    }
    if (!DOMAIN_RE.test(domain)) {
      throw new Error(`${where}: "${domain}" is not a registrable domain`);
    }

    const slug = slugify(name);
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      throw new Error(`${where}: duplicate name of ${seenNames.get(nameKey)}`);
    }
    if (seenDomains.has(domain)) {
      throw new Error(`${where}: domain ${domain} also listed for ${seenDomains.get(domain)}`);
    }
    // Two names that slugify to one slug would collide on the companies unique
    // index, and `on conflict (slug) do nothing` would silently drop the second.
    if (seenSlugs.has(slug)) {
      throw new Error(
        `${where}: slug "${slug}" collides with ${seenSlugs.get(slug)}; rename one so the seed cannot silently drop a row`
      );
    }

    seenNames.set(nameKey, name);
    seenDomains.set(domain, name);
    seenSlugs.set(slug, name);
  }

  return companies;
}

/**
 * Reads the curated design-first block: the companies the picker's initial,
 * empty-query screen shows, in the order it shows them.
 *
 * Throws on a name that is not in `companies`, or on a duplicate, because the
 * migration that applies this list can only mark a company that exists: a typo
 * would silently leave a hole at the top of the picker, which is the one thing
 * the block exists to prevent.
 */
export function loadFeatured(path = DATA_PATH) {
  const source = JSON.parse(readFileSync(path, "utf8"));
  const featured = source.featured ?? [];
  if (!Array.isArray(featured) || featured.length === 0) {
    throw new Error("mnc-companies.json has no `featured` array");
  }

  const names = new Set(loadMncCompanies(path).map((entry) => entry.name));
  const seen = new Set();
  const ordered = [];

  for (const [index, entry] of featured.entries()) {
    const name = String(entry ?? "").trim();
    if (!name) {
      throw new Error(`featured entry ${index + 1} is empty`);
    }
    if (seen.has(name)) {
      throw new Error(`featured lists ${name} twice`);
    }
    if (!names.has(name)) {
      throw new Error(`featured names ${name}, which is not in \`companies\``);
    }
    seen.add(name);
    ordered.push(name);
  }

  return ordered;
}

export function seedSql(companies) {
  const rows = companies
    .map((entry, index) => {
      const country = entry.country ? literal(entry.country) : "null";
      const industry = entry.industry ? literal(entry.industry) : "null";
      return `    (${literal(entry.name)}, ${literal(entry.domain)}, ${country}, ${industry}, ${index + 1})`;
    })
    .join(",\n");

  return `-- ============================================================
-- Migration: the curated MNC company directory (the work-field list)
--
-- GENERATED FILE — do not edit by hand.
--   node scripts/generate-company-directory-mnc-seed.mjs
--   Source: data/company-directory/mnc-companies.json (${companies.length} companies)
--
-- WHAT THIS ADDS
--   ${companies.length} well-known employers across the US, Europe and India, where
--   designers work: one \`companies\` row each and one UNVERIFIED
--   \`company_domains\` hint. A hint is not a claim — it makes the company
--   appear in the "Where do you work?" picker and lets the first member whose
--   work email matches finish the claim through the ordinary OTP flow. It never
--   writes \`verified\`.
--
-- WHY A MIGRATION AND NOT THE IMPORT
--   The 500,000-company import (scripts/import-company-directory.mjs) is a
--   separate, later phase. Until it runs the directory would otherwise be
--   empty. This is the one-time curated list; the admin page
--   (app/admin/(protected)/companies, /api/admin/companies) manages the same
--   two tables at runtime, so an add or a delete there shows in the picker
--   immediately and never needs a second source of truth.
--
-- IDEMPOTENT
--   \`on conflict (slug) do nothing\` and \`on conflict (company_id, domain) do
--   nothing\`: re-running never duplicates a row and never overwrites a
--   member's proof (a verified domain on the same pair is left untouched).
--
-- ALSO
--   Removes accidental one-character test companies (a single-letter name is
--   never a real employer) that were created by hand while exercising the
--   picker.
-- ============================================================

-- ─── Preconditions ──────────────────────────────────────────

-- The seed writes the stewardship columns (country_code, industry, source). A
-- database that has not applied that migration would otherwise fail on the
-- first INSERT with a bare "column does not exist"; say what to do instead.
do $mnc_seed_preconditions$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.company_domains') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'companies' and column_name = 'source'
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'mnc_seed_needs_stewardship_schema',
      hint = 'apply 20260929120000_company_verified_domains.sql, then 20260929130000_company_directory_hints.sql, then 20260929150000_company_domain_stewardship.sql before this seed';
  end if;
end
$mnc_seed_preconditions$;


-- ─── The list, and the two inserts ──────────────────────────

do $mnc_seed$
declare
  v_companies integer;
  v_domains   integer;
begin
  create temporary table _mnc_seed (
    name     text not null,
    domain   text not null,
    country  text,
    industry text,
    rank     integer not null
  ) on commit drop;

  insert into _mnc_seed (name, domain, country, industry, rank) values
${rows};

  -- One company per name. The slug comes from the database's own
  -- company_slugify(), the same function a member-created company uses, so a
  -- directory row and a proved row can never disagree about what a name's slug
  -- is. created_by stays null: these are directory rows, not a member's company.
  insert into public.companies (
    name, slug, country_code, industry, entity_status,
    source, source_confidence, directory_rank
  )
  select
    seed.name,
    public.company_slugify(seed.name),
    seed.country,
    seed.industry,
    'active',
    'curated-mnc',
    'medium',
    seed.rank
  from _mnc_seed as seed
  on conflict (slug) do nothing;
  get diagnostics v_companies = row_count;

  -- One UNVERIFIED hint per company. \`verified = false\` and \`verified_at =
  -- null\` satisfy company_domains_verified_at_check; the partial unique index
  -- on verified domains is untouched, so a domain a member has proved is left
  -- exactly as it is.
  insert into public.company_domains (
    company_id, domain, verified, domain_type, evidence_confidence, source
  )
  select
    company.id,
    lower(btrim(seed.domain)),
    false,
    'primary_website',
    'unknown',
    'curated-mnc'
  from _mnc_seed as seed
  join public.companies as company on company.slug = public.company_slugify(seed.name)
  on conflict (company_id, domain) do nothing;
  get diagnostics v_domains = row_count;

  raise notice 'mnc seed: % companies, % domain hints inserted', v_companies, v_domains;
end
$mnc_seed$;


-- ─── Drop accidental one-character test companies ───────────

-- A one-character company name ("l", "a") is a typo or a test of the picker,
-- never a real employer. Deleting the company cascades its domains,
-- memberships and challenges, and clears any profile that pointed at it — which
-- is precisely "remove it from the work field". Idempotent: nothing matches
-- after the first run.
delete from public.companies
 where slug ~ '^[a-z0-9]$';
`;
}

function main() {
  const companies = loadMncCompanies();
  const sql = seedSql(companies);

  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT_PATH, "utf8");
    if (current !== sql) {
      console.error(
        "the committed MNC seed migration does not match data/company-directory/mnc-companies.json; " +
          "run `node scripts/generate-company-directory-mnc-seed.mjs` and commit the result"
      );
      process.exitCode = 1;
      return;
    }
    console.log(`mnc seed matches the curated list (${companies.length} companies)`);
    return;
  }

  writeFileSync(OUT_PATH, sql);
  console.log(
    `Wrote ${OUT_PATH.replace(`${ROOT}/`, "")} (${companies.length} companies, ${sql.length} bytes)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
