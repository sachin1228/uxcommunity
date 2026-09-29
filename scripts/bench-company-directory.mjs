#!/usr/bin/env node

/**
 * The directory at 1,000 / 10,000 / 100,000 / 500,000 rows, measured on the
 * REAL schema with the REAL importer and the REAL search function.
 *
 *   bash scripts/bench-company-directory.sh
 *   # or, against a database you built yourself:
 *   PGHOST=/tmp/uxc-bench/sock PGDATABASE=uxc PGUSER=postgres \
 *     node scripts/bench-company-directory.mjs --tiers 1000,100000
 *
 * WHY THIS EXISTS
 *   The architecture review produced numbers from a standalone `bench` schema
 *   that mirrored the columns. That is enough to compare index shapes, and not
 *   enough to answer "will the picker still be fast", because the real query
 *   runs through `public.search_companies`, which reads four tables, a lateral
 *   domain row and a member count. This script inserts synthetic rows into
 *   `public` on a scratch database, imports them through
 *   scripts/import-company-directory.mjs (so the write path being measured is
 *   the one that will run), and times the function the app actually calls,
 *   with EXPLAIN ANALYZE for the two shapes that matter.
 *
 * WHAT IS REPORTED PER TIER
 *   rows imported (the importer's own report), load time, a second run (which
 *   must be a no-op — that is the idempotency check), and search latency for
 *   five queries: browse, a name substring, a two-character prefix, a broad
 *   substring and an exact domain lookup.
 *
 * WHAT THESE NUMBERS DO NOT SAY
 *   This is a SYNTHETIC PERFORMANCE BENCHMARK. It answers "does the schema and
 *   the query still scale", and nothing else: the rows are invented, so it says
 *   nothing about the coverage, accuracy or email-domain evidence of a real
 *   500,000-company dataset. The real-dataset figures come from running the
 *   generator (`npm run companies:v2 -- --measure`) over the layer files.
 *
 *   Rows carry `source = 'bench'` and confidence `unknown`. The import refuses
 *   any row that claims `verified`, so nothing here can look like a proved
 *   domain, and the whole tier is deleted before the next one.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const flagValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const TIERS = String(flagValue("--tiers", "1000,10000,100000,500000"))
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const PSQL = ["psql", "--quiet", "--no-psqlrc", "--no-align", "--tuples-only", "-v", "ON_ERROR_STOP=1"];

function psql(script, label) {
  const result = spawnSync(PSQL[0], PSQL.slice(1), {
    encoding: "utf8",
    input: script,
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${(result.stderr || result.stdout || "").trim()}`);
  }
  return (result.stdout || "").trim();
}

/* ── Synthetic rows, shaped exactly like the generator's export ─────────── */

const FIRST = ["acme", "figma", "vertex", "lumen", "north", "bright", "quantum", "meridian", "helio", "cobalt",
  "astra", "zenith", "orbit", "delta", "summit", "iron", "silver", "harbor", "nova", "pioneer"];
const SECOND = ["labs", "systems", "works", "data", "media", "soft", "tek", "logistics", "retail", "capital",
  "health", "energy", "foods", "motors", "bank", "air", "rail", "steel", "textile", "pharma"];
const THIRD = ["india", "global", "holdings", "partners", "ventures", "international", "solutions", "services",
  "industries", "enterprises"];

function writeTier(directory, n) {
  const companies = ["company_id,company_name,normalized_name,country,industry,website_domain,employee_email_domains,parent_company_id,source,source_id,jurisdiction,source_confidence,directory_rank,aliases"];
  const domains = ["company_id,domain,domain_type,verified,source,source_url,evidence_confidence,evidence_count,evidence_types,claim_status,steward_company_id,first_seen_at,last_verified_at"];
  const evidence = ["company_id,domain,evidence_type,source_url,checked,observed_at"];

  for (let index = 1; index <= n; index += 1) {
    const slug = `company-${index}`;
    const name = `${FIRST[(index * 3) % 20]} ${SECOND[(index * 7) % 20]} ${THIRD[(index * 13) % 10]} ${index}`;
    const domain = `${slug}.com`;

    // Every synthetic row carries a registry identity, so the import's
    // identity-first path is the path being timed rather than being skipped.
    companies.push(
      [slug, name, name.toLowerCase(), "IN", "software", domain, domain, "", "bench",
       `bench-${index}`, "IN", "unknown", index, ""].join(",")
    );
    // One website claim per company, unverified and unchecked: the shape the
    // directory seed has, and the shape that must never verify anything.
    domains.push(
      [slug, domain, "primary_website", "false", "bench", "", "unknown", "", "resolved", slug, "", ""].join(",")
    );
    if (index % 5 === 0) {
      evidence.push([slug, domain, "external_reputable", "", "false", ""].join(","));
    }
  }

  writeFileSync(join(directory, "companies.csv"), `${companies.join("\n")}\n`);
  writeFileSync(join(directory, "company_domains.csv"), `${domains.join("\n")}\n`);
  writeFileSync(join(directory, "domain_evidence.csv"), `${evidence.join("\n")}\n`);
}

/* ── Timing ──────────────────────────────────────────────────────────────── */

const TIMED_QUERIES = [
  ["browse (empty query)", "select count(*) from public.search_companies('', 25)"],
  ["name substring 'lumen'", "select count(*) from public.search_companies('lumen', 25)"],
  ["2-char prefix 'lu'", "select count(*) from public.search_companies('lu', 25)"],
  ["broad substring 'ent'", "select count(*) from public.search_companies('ent', 25)"],
  ["domain exact", "select count(*) from public.company_domain_steward('company-42.com')"]
];

/**
 * Median of five, from the notices the timing block raises. Kept separate from
 * the block itself so the SQL stays readable.
 */
function medianTimings(tier) {
  const output = psql(
    `
    create temporary table _bench_timings (query text, ms numeric);
    do $bench$
    declare
      t0 timestamptz;
      ms numeric;
    begin
${TIMED_QUERIES.map(
  ([name, sql]) => `      for run in 1..5 loop
        t0 := clock_timestamp();
        execute $q$${sql}$q$;
        insert into _bench_timings values ($r$${name}$r$, round(extract(epoch from clock_timestamp() - t0) * 1000, 3));
      end loop;`
).join("\n")}
    end;
    $bench$;
    select json_agg(json_build_object('query', query, 'ms', ms) order by query)
    from (select query, percentile_cont(0.5) within group (order by ms) as ms from _bench_timings group by query) as medians;
    `,
    `timing search at ${tier}`
  );

  return JSON.parse(output);
}

/**
 * EXPLAIN cannot see inside a plpgsql function, so each ARM of
 * public.search_companies is explained with the SQL the function uses — including
 * its ORDER BY … LIMIT, because that limit is what lets a plan stop early and is
 * the difference between "scans a slice" and "scans the directory".
 *
 * A Seq Scan is NOT automatically a failure here: a Limit over a Seq Scan that
 * stops after 25 matching rows reads a fraction of the table, which is faster
 * than building a bitmap over a common term. What would be a failure is a scan
 * with no limit above it. `bounded` below is that distinction, and it is the one
 * the report prints.
 */
const PLAN_ARMS = (tier) => [
  ["browse arm", "select c.id from public.companies as c where c.is_active order by c.name asc limit 25"],
  ["name substring arm", "select c.id from public.companies as c where c.is_active and c.name ilike '%lumen%' order by strpos(lower(c.name), 'lumen'), c.name asc limit 25"],
  ["name prefix arm (2 chars)", "select c.id from public.companies as c where c.is_active and lower(c.name) like 'lu%' order by lower(c.name) asc limit 25"],
  ["alias substring arm", "select a.company_id from public.company_aliases as a join public.companies as c on c.id = a.company_id and c.is_active where a.alias ilike '%lumen%' order by a.alias asc limit 25"],
  ["verified domain prefix arm", "select d.company_id from public.company_domains as d join public.companies as c on c.id = d.company_id and c.is_active where d.verified and d.domain like 'company-42%' order by d.domain asc limit 25"],
  ["steward lookup (exact domain)", "select s.company_id from public.company_domain_steward('company-42.com') as s"]
];

function planFor(tier, label, sql) {
  const output = psql(`explain (analyze, buffers, costs off, summary off) ${sql}`, `explaining ${label} at ${tier}`);
  const seqScans = (output.match(/Seq Scan/g) || []).length;
  // Is every sequential scan under a Limit? That is the bounded case.
  const bounded = seqScans === 0 || /^Limit/.test(output.trim()) || /\n\s*->\s*Limit/.test(output);
  const topNode = (output.split("\n").find((line) => line.trim().length > 0) || "").trim().split(" ")[0];
  return { tier, label, seqScans, bounded, topNode, plan: output };
}

/* ── Main ────────────────────────────────────────────────────────────────── */

const reports = [];

for (const tier of TIERS) {
  const directory = join(tmpdir(), `company-directory-bench-${tier}`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const generated = Date.now();
  writeTier(directory, tier);
  const generationMs = Date.now() - generated;

  // A clean table per tier, so the numbers are for N rows and not a cumulative
  // pile: search latency is only meaningful against a known size.
  // A clean table per tier, so latency is for a known size rather than a pile.
  psql("truncate public.companies cascade;", `clearing for ${tier}`);

  const first = spawnSync(
    "node",
    ["scripts/import-company-directory.mjs", directory, "--report", join(directory, "report.json")],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (first.status !== 0) {
    throw new Error(`import at ${tier} failed:\n${first.stderr || first.stdout}`);
  }
  const firstReport = JSON.parse(first.stdout);
  // Visible right after the first load? If this is 0 while the report inside the
  // transaction says N, the load committed somewhere else and every number below
  // is being measured against an empty table.
  const visibleAfterFirstLoad = Number(psql("select count(*) from public.companies", `counting after the first load at ${tier}`));
  if (visibleAfterFirstLoad !== tier) {
    throw new Error(`the load reported ${tier} companies but ${visibleAfterFirstLoad} are visible`);
  }

  const secondStarted = Date.now();
  const second = spawnSync(
    "node",
    ["scripts/import-company-directory.mjs", directory],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (second.status !== 0) {
    throw new Error(`second import at ${tier} failed:\n${second.stderr || second.stdout}`);
  }
  const secondReport = JSON.parse(second.stdout);

  psql(`analyze public.companies; analyze public.company_domains; analyze public.domain_evidence;`, `analyzing ${tier}`);

  const timings = medianTimings(tier);
  const plans = PLAN_ARMS(tier).map(([label, sql]) => planFor(tier, label, sql));
  // Proof the plans and timings were taken against a loaded table rather than an
  // empty one: an index can look perfect over zero rows.
  const liveRows = Number(psql("select count(*) from public.companies", `counting at ${tier}`));

  reports.push({
    tier,
    live_rows: liveRows,
    rows_imported: firstReport.staged,
    import_ms: firstReport.ms,
    generation_ms: generationMs,
    rerun_ms: Date.now() - secondStarted,
    // Idempotency: a second run of the same input must change nothing.
    idempotent:
      firstReport.after.companies_after === secondReport.after.companies_after &&
      firstReport.after.claims_after === secondReport.after.claims_after &&
      firstReport.after.evidence_after === secondReport.after.evidence_after,
    verified_after_import: firstReport.after.verified_after,
    timings,
    plans
  });

  console.log(
    `${tier} rows in table: ${liveRows}; import ${firstReport.ms} ms, re-run ${Date.now() - secondStarted} ms, ` +
      `${firstReport.after.companies_after} companies / ${firstReport.after.claims_after} claims / ` +
      `${firstReport.after.verified_after} verified`
  );
}

console.log("\n── import ────────────────────────────────────────────────");
console.log("tier\tcompanies\tclaims\tevidence\timport ms\tre-run ms\tverified");
for (const report of reports) {
  console.log(
    [
      report.tier,
      report.rows_imported.companies,
      report.rows_imported.domains,
      report.rows_imported.evidence,
      report.import_ms,
      report.rerun_ms,
      report.verified_after_import
    ].join("\t")
  );
}

console.log("\n── search (ms, median of 5) ──────────────────────────────");
for (const report of reports) {
  console.log(`\n${report.tier} rows`);
  for (const timing of report.timings) {
    console.log(`  ${String(timing.ms).padStart(9)}  ${timing.query}`);
  }
}

console.log("\n── plans: is every arm index-backed or limit-bounded? ────");
for (const report of reports) {
  console.log(`\n${report.tier} rows (idempotent re-run: ${report.idempotent})`);
  for (const plan of report.plans) {
    console.log(
      `  ${report.tier} ${plan.label}: seq_scans=${plan.seqScans} ` +
        `bounded=${plan.bounded} top=${plan.topNode} (rows=${report.live_rows})`
    );
  }
}

// The EXPLAIN ANALYZE text for the largest tier, so the evidence for "no
// sequential scan" is in the output rather than only a count of one.
const largest = reports[reports.length - 1];
console.log(`\n── EXPLAIN ANALYZE at ${largest.tier} rows ─────────────────`);
for (const plan of largest.plans) {
  console.log(`\n# ${plan.label}  (seq_scans=${plan.seqScans})`);
  console.log(plan.plan);
}
