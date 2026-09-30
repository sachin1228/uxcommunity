/**
 * The company-directory ROUND TRIP: source layers → generator → CSVs → importer
 * → scratch database → read back out → compared row for row.
 *
 *   bash scripts/run-company-directory-scratch.sh scripts/company-directory-roundtrip.test.mjs
 *
 * WHY THIS EXISTS, GIVEN THE OTHER TWO SUITES
 *   generate-company-directory-v2.test.mjs checks what the generator WRITES, and
 *   import-company-directory.test.mjs checks what the importer STAGES. Neither
 *   can see the property that actually matters — whether a fact that leaves the
 *   curated layer comes back out of Postgres unchanged — because a column the
 *   importer ignores is invisible to both. That is not hypothetical: the export
 *   used to carry `website_domain`, `employee_email_domains`, `parent_company_id`
 *   and a `;`-joined `aliases`, the importer read none of them, and both suites
 *   were green while 17 relationships and 31 names were being dropped on the
 *   floor. This file is the one that would have caught it.
 *
 * WHAT IT ASSERTS
 *   The five feeds, compared as SETS against the tables: companies (identity,
 *   registry number, rank), domain claims (pair, type, confidence, source),
 *   evidence observations (type, URL, source, checked/observed), aliases (name,
 *   type, company) and relationships (both ends, type). Plus the invariants that
 *   must hold whatever the data says: nothing is verified, a website claim never
 *   becomes an email claim, no duplicates, no orphans, and a second import
 *   changes no row.
 *
 * HOW IT RUNS
 *   It needs a scratch PostgreSQL, because the importer connects with psql(1).
 *   The runner builds one from schema.sql plus every migration and exports
 *   PGHOST/PGDATABASE/PGUSER. Without those three variables this file FAILS
 *   loudly rather than skipping: a suite that reports "lossless" while connected
 *   to nothing is worse than no suite at all.
 *
 *   Nothing here touches a project database. The generator writes into a
 *   temporary directory via COMPANY_DIRECTORY_OUT_DIR, the importer runs WITHOUT
 *   --dry-run so the rows really commit into the scratch cluster, and the runner
 *   deletes that cluster on exit.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parseCsv, uuidv5 } from "./import-company-directory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = join(ROOT, "scripts/generate-company-directory-v2.mjs");
const IMPORTER = join(ROOT, "scripts/import-company-directory.mjs");
// 1,000 rows is the reviewable prototype scale; the full dataset is a bigger
// cap that still exercises every assertion, because none of them is count-based.
// COMPANY_DIRECTORY_SAMPLE=10000 runs this same suite over the whole export.
const SAMPLE = process.env.COMPANY_DIRECTORY_SAMPLE ?? "1000";
const MAX_BUFFER = 64 * 1024 * 1024;

/** The exact table counts. An orphan or a duplicate moves these and nothing else does. */
const COUNTS_SQL = `
  select
    (select count(*) from public.companies)                                    as companies,
    (select count(distinct slug) from public.companies)                        as distinct_slugs,
    (select count(distinct id) from public.companies)                          as distinct_ids,
    (select count(*) from public.company_domains)                              as domains,
    (select count(distinct (company_id, domain)) from public.company_domains)  as distinct_domain_pairs,
    (select count(distinct domain) from public.company_domains)                as distinct_domains,
    (select count(*) from public.company_domains where verified)               as verified,
    (select count(*) from public.domain_evidence)                              as evidence,
    (select count(*) from public.company_aliases)                              as aliases,
    (select count(*) from public.company_aliases as a
       left join public.companies as c on c.id = a.company_id
       where c.id is null)                                                     as orphan_aliases,
    (select count(*) from public.company_relationships)                        as relationships,
    (select count(*) from public.company_relationships as r
       left join public.companies as p on p.id = r.parent_company_id
       left join public.companies as k on k.id = r.child_company_id
       where p.id is null or k.id is null)                                     as orphan_relationships,
    (select count(*) from public.company_relationships
       where parent_company_id = child_company_id)                             as self_relationships,
    (select count(*) from public.domain_evidence as e
       left join public.companies as c on c.id = e.company_id
       where c.id is null)                                                     as orphan_evidence`;

/**
 * Runs one query and returns its rows as objects. `json_agg` rather than
 * aligned text: the export contains commas, quotes and semicolons, and a
 * comparison a delimiter can corrupt is not a comparison.
 */
function query(sql) {
  const result = spawnSync(
    "psql",
    [
      "--quiet",
      "--no-psqlrc",
      "--no-align",
      "--tuples-only",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t`
    ],
    { encoding: "utf8", env: process.env, maxBuffer: MAX_BUFFER }
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout.trim());
}

function spawnNode(args, env) {
  return spawnSync(process.execPath, args, { encoding: "utf8", env, maxBuffer: MAX_BUFFER });
}

const state = { outDir: null, report: null, csv: {}, db: {}, counts: {} };

/**
 * What the database holds, read back through the company rows. Every read joins
 * `companies`, so an orphan is invisible here and is caught by COUNTS_SQL
 * instead - which is the point of counting the tables rather than the joins.
 */
function readBack() {
  state.db.companies = query(`
    select id::text as id, slug, name, country_code, industry, entity_status,
           source, source_id, jurisdiction, source_confidence, directory_rank
    from public.companies order by slug`);
  state.db.domains = query(`
    select c.slug as company_slug, d.domain, d.domain_type, d.evidence_confidence, d.source, d.verified
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id
    order by d.domain, c.slug`);
  state.db.evidence = query(`
    select c.slug as company_slug, e.domain, e.evidence_type, e.source_url, e.source, e.checked,
           (e.observed_at is not null) as observed
    from public.domain_evidence as e
    join public.companies as c on c.id = e.company_id
    order by e.domain, e.evidence_type`);
  state.db.aliases = query(`
    select c.slug as company_slug, a.alias, a.alias_type, a.source
    from public.company_aliases as a
    join public.companies as c on c.id = a.company_id
    order by c.slug, a.alias`);
  state.db.relationships = query(`
    select p.slug as parent_slug, k.slug as child_slug, r.relationship_type, r.source
    from public.company_relationships as r
    join public.companies as p on p.id = r.parent_company_id
    join public.companies as k on k.id = r.child_company_id
    order by p.slug, k.slug, r.relationship_type`);
  state.counts = query(COUNTS_SQL)[0];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** An absent value and the empty string are the same thing to COPY … csv. */
const norm = (value) => (value === undefined || value === null || value === "" ? null : value);
const num = (value) => (norm(value) === null ? null : Number(value));
/** Sets, not sequences: the generator's row ORDER is not what is under test. */
const tuples = (rows) => rows.map((row) => JSON.stringify(row)).sort();

/** The generator writes all five, always; a missing one is a generator bug. */
function readExport(name) {
  const path = join(state.outDir, `${name}.csv`);
  assert.ok(statSync(path).isFile(), `${name}.csv was written`);
  return state.csv[name];
}

/* ── The pipeline, run once ──────────────────────────────────────────────── */

before(() => {
  const missing = ["PGHOST", "PGDATABASE", "PGUSER"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not set. This suite needs a scratch PostgreSQL:\n` +
        `  bash scripts/run-company-directory-scratch.sh scripts/company-directory-roundtrip.test.mjs\n` +
        `It must never be pointed at a project database.`
    );
  }

  const outDir = mkdtempSync(join(tmpdir(), "uxc-roundtrip-"));
  state.outDir = outDir;

  // 1. the curated/source layers → the export. The real CLI, so this exercises
  //    exactly what a maintainer runs; only the output directory is redirected.
  const generated = spawnNode([GENERATOR, "--sample", SAMPLE], {
    ...process.env,
    COMPANY_DIRECTORY_OUT_DIR: outDir
  });
  if (generated.status !== 0) {
    throw new Error(`generator failed:\n${generated.stdout}\n${generated.stderr}`);
  }

  // 2. the export → the scratch database. NOT --dry-run: the point is to read
  //    rows back out of tables, so the transaction has to commit.
  const reportPath = join(outDir, "import-report-1.json");
  const imported = spawnNode([IMPORTER, "--report", reportPath, outDir], process.env);
  if (imported.status !== 0) {
    throw new Error(`importer failed:\n${imported.stdout}\n${imported.stderr}`);
  }
  state.report = JSON.parse(readFileSync(reportPath, "utf8"));

  // 3. what the export says, read with the importer's own parser so the two
  //    sides cannot disagree about quoting. Keyed by the file's base name.
  const read = (name) => parseCsv(readFileSync(join(outDir, `${name}.csv`), "utf8"));
  state.csv = {
    companies: read("companies"),
    company_domains: read("company_domains"),
    domain_evidence: read("domain_evidence"),
    company_aliases: read("company_aliases"),
    company_relationships: read("company_relationships")
  };

  // 4. what the database holds.
  readBack();
});

process.on("exit", () => {
  if (state.outDir) rmSync(state.outDir, { recursive: true, force: true });
});

/* ── 1. Companies ────────────────────────────────────────────────────────── */

test("every company survives with its identity, registry number and rank", () => {
  const expected = readExport("companies").map((row) => [
    row.company_id,
    row.company_name,
    norm(row.country),
    norm(row.industry),
    norm(row.source),
    norm(row.source_id),
    norm(row.jurisdiction),
    norm(row.source_confidence),
    num(row.directory_rank)
  ]);
  const actual = state.db.companies.map((row) => [
    row.slug,
    row.name,
    norm(row.country_code),
    norm(row.industry),
    norm(row.source),
    norm(row.source_id),
    norm(row.jurisdiction),
    norm(row.source_confidence),
    num(row.directory_rank)
  ]);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(tuples(actual), tuples(expected));
});

test("company ids are the deterministic UUIDv5 of the slug, and no slug moved", () => {
  for (const row of state.db.companies) {
    assert.equal(row.id, uuidv5(row.slug), `${row.slug} keeps the id derived from its slug`);
  }
  // The exporter's slug is a public handle; an import must never rewrite it.
  assert.equal(state.report.after.companies_that_changed_slug, 0);
  assert.equal(state.report.after.companies_matched_by_registry_identity, 0, "the scratch database starts empty");
});

/* ── 2. Domain claims ────────────────────────────────────────────────────── */

test("every company/domain pair survives with its type, confidence and source", () => {
  const expected = readExport("company_domains").map((row) => [
    row.company_id,
    row.domain,
    row.domain_type,
    row.evidence_confidence,
    norm(row.source)
  ]);
  const actual = state.db.domains.map((row) => [
    row.company_slug,
    row.domain,
    row.domain_type,
    row.evidence_confidence,
    norm(row.source)
  ]);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(tuples(actual), tuples(expected));
});

/* ── 3. Evidence observations ────────────────────────────────────────────── */

test("every evidence observation survives with its type, URL and provenance", () => {
  const expected = readExport("domain_evidence").map((row) => [
    row.company_id,
    row.domain,
    row.evidence_type,
    norm(row.source_url),
    norm(row.source),
    row.checked === "true"
  ]);
  const actual = state.db.evidence.map((row) => [
    row.company_slug,
    row.domain,
    row.evidence_type,
    norm(row.source_url),
    norm(row.source),
    row.checked
  ]);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(tuples(actual), tuples(expected));
});

test("a timestamp is never invented by the pipeline", () => {
  // observed_at is the honest time a human or a job looked; the generator leaves
  // it empty on purpose, so a round trip must not manufacture one.
  assert.ok(readExport("domain_evidence").every((row) => norm(row.observed_at) === null));
  assert.ok(state.db.evidence.every((row) => row.observed === false), "no observation claims to have been observed");
});

/* ── 4. Aliases ──────────────────────────────────────────────────────────── */

test("every alias survives with its type and its company", () => {
  const expected = readExport("company_aliases").map((row) => [row.company_id, row.alias, row.alias_type, norm(row.source)]);
  const actual = state.db.aliases.map((row) => [row.company_slug, row.alias, row.alias_type, norm(row.source)]);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(tuples(actual), tuples(expected));
  assert.ok(expected.length >= 31, `the curated layer carries 31 names today, got ${expected.length}`);
});

test("a former name is stored as a former_name and stays search-only", () => {
  const meta = state.db.aliases.filter((row) => row.company_slug === "meta-platforms");
  const former = meta.filter((row) => row.alias_type === "former_name").map((row) => row.alias).sort();
  assert.deepEqual(former, ["Facebook Inc.", "Facebook, Inc."]);
  // The former names did not fold the brand entity into its parent.
  assert.ok(state.db.companies.some((row) => row.slug === "facebook"));
});

/* ── 5. Relationships ────────────────────────────────────────────────────── */

test("every relationship survives with both ends and its type", () => {
  const expected = readExport("company_relationships").map((row) => [
    row.parent_company_id,
    row.child_company_id,
    row.relationship_type,
    norm(row.source)
  ]);
  const actual = state.db.relationships.map((row) => [
    row.parent_slug,
    row.child_slug,
    row.relationship_type,
    norm(row.source)
  ]);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(tuples(actual), tuples(expected));
  assert.ok(expected.length >= 17, `the curated layer carries 17 edges today, got ${expected.length}`);
});

test("no relationship points at itself", () => {
  assert.equal(state.counts.self_relationships, 0);
  assert.ok(state.db.relationships.every((row) => row.parent_slug !== row.child_slug));
});

/* ── 6. Invariants ───────────────────────────────────────────────────────── */

test("a website claim never becomes an email claim", () => {
  const exportType = new Map(
    readExport("company_domains").map((row) => [`${row.company_id}|${row.domain}`, row.domain_type])
  );
  for (const row of state.db.domains) {
    assert.equal(
      row.domain_type,
      exportType.get(`${row.company_slug}|${row.domain}`),
      `${row.company_slug}/${row.domain} kept the type the export stated`
    );
  }
  const email = state.db.domains.filter((row) => row.domain_type === "corporate_email");
  const websites = state.db.domains.filter((row) => row.domain_type === "primary_website");
  const exported = readExport("company_domains").filter((row) => row.domain_type === "corporate_email");
  assert.ok(email.length > 0, "the export does carry email claims");
  assert.ok(websites.length > email.length, "and vastly more website claims");
  // The numbers differ, so nothing derived one from the other.
  assert.equal(email.length, exported.length);
});

test("nothing the pipeline writes is verified", () => {
  assert.equal(state.counts.verified, 0);
  assert.ok(state.db.domains.every((row) => row.verified === false));
  assert.equal(state.report.after.verified_after, 0);
  assert.equal(state.report.after.skipped_verified_claims, 0);
});

test("no duplicate companies, domains, aliases or relationships", () => {
  assert.equal(state.counts.companies, state.counts.distinct_slugs);
  assert.equal(state.counts.companies, state.counts.distinct_ids);
  assert.equal(state.counts.domains, state.counts.distinct_domain_pairs);
  assert.equal(state.counts.domains, state.counts.distinct_domains, "no domain is claimed twice");
  assert.equal(
    state.counts.aliases,
    new Set(state.db.aliases.map((row) => `${row.company_slug}|${row.alias}`)).size
  );
  assert.equal(
    state.counts.relationships,
    new Set(state.db.relationships.map((row) => `${row.parent_slug}|${row.child_slug}|${row.relationship_type}`)).size
  );
});

test("no orphan aliases, relationships or evidence", () => {
  assert.equal(state.counts.orphan_aliases, 0);
  assert.equal(state.counts.orphan_relationships, 0);
  assert.equal(state.counts.orphan_evidence, 0);
  // And every referenced company is one the export described: the table counts
  // are exact, and the scratch database started empty.
  const slugs = new Set(state.db.companies.map((row) => row.slug));
  const exported = new Set(readExport("companies").map((row) => row.company_id));
  assert.deepEqual([...slugs].sort(), [...exported].sort());
  for (const row of [...state.db.aliases, ...state.db.evidence]) {
    assert.ok(slugs.has(row.company_slug), `${row.company_slug} is a company this export created`);
  }
  for (const row of state.db.relationships) {
    assert.ok(slugs.has(row.parent_slug) && slugs.has(row.child_slug));
  }
});

test("the importer staged and wrote every feed without rejecting a row", () => {
  const dataset = state.report.dataset;
  assert.equal(state.report.dry_run, false);
  assert.equal(dataset.rejected_rows, 0);
  assert.deepEqual(dataset.rejected_by_reason, {});
  assert.equal(state.report.feeds.aliases, "supplied");
  assert.equal(state.report.feeds.relationships, "supplied");
  assert.equal(state.counts.companies, dataset.unique_companies);
  assert.equal(state.counts.domains, dataset.input_rows.domains);
  assert.equal(state.counts.evidence, dataset.input_rows.evidence);
  assert.equal(state.counts.aliases, dataset.input_rows.aliases);
  assert.equal(state.counts.relationships, dataset.input_rows.relationships);
  assert.equal(state.report.after.aliases_after, dataset.input_rows.aliases);
  assert.equal(state.report.after.relationships_after, dataset.input_rows.relationships);
});

/* ── 7. Idempotence, which is how "no duplicates" is really proved ───────── */

test("importing the same export a second time changes no row", () => {
  const before = JSON.stringify([state.counts, state.db]);
  const reportPath = join(state.outDir, "import-report-2.json");
  const again = spawnNode([IMPORTER, "--report", reportPath, state.outDir], process.env);
  assert.equal(again.status, 0, `the second import must succeed:\n${again.stdout}\n${again.stderr}`);
  const second = JSON.parse(readFileSync(reportPath, "utf8"));

  readBack();
  assert.equal(JSON.stringify([state.counts, state.db]), before, "the second import added or changed nothing");
  for (const key of ["companies_after", "claims_after", "evidence_after", "aliases_after", "relationships_after"]) {
    assert.equal(second.after[key], state.report.after[key], `${key} is stable across runs`);
  }
});
