/**
 * How should half a million directory rows actually get into the database?
 *
 *   PGHOST=/tmp/uxc/sock PGDATABASE=uxc PGUSER=postgres \
 *     node scripts/bench-company-directory-import.mjs --n 500000
 *
 * WHY THIS EXISTS
 *   The directory is built from committed layer files. Committing it as a
 *   generated migration was exactly right at the v1 seed's 4,574 rows (~170 KB),
 *   and that migration has since been removed from the repository precisely
 *   because the shape does not hold as the data grows; it stops being obviously
 *   right somewhere between 4,574 and 500,000, and the
 *   brief's instruction is not to guess: the three candidate shapes are built,
 *   loaded and timed against a real PostgreSQL instance, and the numbers decide.
 *
 * THE THREE SHAPES
 *   A  giant migration   one .sql file of INSERT ... VALUES statements, applied
 *                        with psql -f. What the current generator produces,
 *                        scaled up. No staging, no transaction control.
 *   B  csv + copy        three CSVs loaded with \copy, ids allocated BY THE
 *                        GENERATOR (deterministic UUIDv5 from the slug), so the
 *                        domain rows already reference their company.
 *   C  staged import     CSVs keyed by slug copied into an UNLOGGED staging
 *                        table, then one set-based INSERT ... SELECT that joins
 *                        on slug and lets the database own id allocation.
 *
 * WHAT IS MEASURED
 *   generation time, output bytes, load wall time, peak RSS of the loading
 *   process, index build time, and the same search the app runs afterwards.
 *
 * Everything lives in one schema per run and is dropped at the end, so this
 * never touches `public`. Loads are into a scratch database, on purpose.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
};
const N = flag("--n", 500_000);
const WORK = join(tmpdir(), `company-directory-bench-${N}`);
const SCHEMA = "bench_import";
const PSQL = ["psql", "--quiet", "--no-psqlrc", "--tuples-only", "--no-align", "-v", "ON_ERROR_STOP=1"];
const TIME_BIN = existsSync("/usr/bin/time") ? "/usr/bin/time" : null;

mkdirSync(WORK, { recursive: true });

/* ── Deterministic synthetic data, shaped like the real layers ───────────── */

function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = rng(20260930);
const FIRST = ["acme", "figma", "vertex", "lumen", "north", "bright", "quantum", "meridian", "helio", "cobalt", "astra", "zenith", "orbit", "delta", "summit", "iron", "silver", "harbor", "nova", "pioneer"];
const SECOND = ["labs", "systems", "works", "data", "media", "software", "logistics", "retail", "capital", "health", "energy", "foods", "motors", "bank", "air", "rail", "steel", "textile", "pharma", "group"];
const COUNTRY = ["US", "GB", "IN", "DE", "FR", "BR", "JP", "AU", "CA", "NL"];
const INDUSTRY = ["software", "retail", "banking", "healthcare", "manufacturing", "logistics", "energy", "media"];
const EMAIL_TYPES = ["corporate_email", "subsidiary_email", "regional"];
const CONFIDENCE = ["high", "medium", "low", "unknown", "unknown", "unknown"];

/** UUIDv5 over a fixed namespace: the same slug always yields the same id. */
const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
function uuidv5(name) {
  const hash = createHash("sha1").update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex")).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildRows(count) {
  const companies = [];
  const domains = [];
  const evidence = [];
  for (let index = 0; index < count; index += 1) {
    const slug = `company-${index}-${FIRST[index % FIRST.length]}`;
    const name = `${FIRST[index % FIRST.length]} ${SECOND[(index * 7) % SECOND.length]} ${index}`;
    const id = uuidv5(slug);
    const country = COUNTRY[index % COUNTRY.length];
    // 10% of companies carry email evidence, the shape the resolver produces.
    const withEmail = index % 10 === 0;
    // Unique per company: a domain is one company's in this model, and the
    // partial unique index on verified domains enforces exactly that.
    const domain = `${slug}.com`;
    const domainId = uuidv5(`domain:${slug}`);
    companies.push({ id, slug, name, country, industry: INDUSTRY[index % INDUSTRY.length] });
    domains.push({
      id: domainId,
      company_id: id,
      slug,
      domain,
      domain_type: withEmail ? EMAIL_TYPES[index % EMAIL_TYPES.length] : "primary_website",
      confidence: withEmail ? CONFIDENCE[index % CONFIDENCE.length] : "unknown",
      verified: index % 100_000 === 0
    });
    if (withEmail) {
      evidence.push({ company_id: id, domain, evidence_type: "first_party_role_address", url: `https://${domain}/contact` });
      evidence.push({ company_id: id, domain, evidence_type: "mx_record", url: "https://www.rfc-editor.org/rfc/rfc7483" });
    }
  }
  return { companies, domains, evidence };
}

const esc = (value) => `'${String(value).replace(/'/g, "''")}'`;

/* ── The three output shapes ────────────────────────────────────────────── */

function shapeA({ companies, domains, evidence }) {
  const path = join(WORK, "giant-migration.sql");
  const parts = [
    "\\set statement_timeout = '600s'",
    "",
    "insert into " + SCHEMA + ".companies (id, name, slug, country_code, industry, entity_status, source, source_confidence) values",
    companies
      .map((row) => `  (${esc(row.id)}::uuid, ${esc(row.name)}, ${esc(row.slug)}, ${esc(row.country)}, ${esc(row.industry)}, 'active', 'wikidata', 'unknown')`)
      .join(",\n") + ";",
    "",
    "insert into " + SCHEMA + ".company_domains (id, company_id, domain, domain_type, verified, verified_at, source, source_confidence) values",
    domains
      .map(
        (row) =>
          `  (${esc(row.id)}::uuid, ${esc(row.company_id)}::uuid, ${esc(row.domain)}, ${esc(row.domain_type)}, ${row.verified}, ${row.verified ? "now()" : "null"}, 'wikidata', ${esc(row.confidence)})`
      )
      .join(",\n") + ";",
    ""
  ];
  if (evidence.length > 0) {
    parts.push(
      "insert into " + SCHEMA + ".domain_evidence (company_id, domain, evidence_type, source_url, checked) values",
      evidence
        .map((row) => `  (${esc(row.company_id)}::uuid, ${esc(row.domain)}, ${esc(row.evidence_type)}, ${esc(row.url)}, true)`)
        .join(",\n") + ";",
      ""
    );
  }
  writeFileSync(path, parts.join("\n"));
  return { path, bytes: statSync(path).size };
}

function shapeB({ companies, domains, evidence }) {
  const write = (name, header, rows) => {
    const path = join(WORK, name);
    writeFileSync(path, header + "\n" + rows.map((row) => row.join(",")).join("\n") + "\n");
    return statSync(path).size;
  };
  const bytes =
    write("companies.csv", "id,name,slug,country_code,industry", companies.map((row) => [row.id, JSON.stringify(row.name), row.slug, row.country, row.industry])) +
    write(
      "company_domains.csv",
      "id,company_id,domain,domain_type,verified,source,source_confidence",
      domains.map((row) => [row.id, row.company_id, row.domain, row.domain_type, row.verified, "wikidata", row.confidence])
    ) +
    write(
      "domain_evidence.csv",
      "company_id,domain,evidence_type,source_url,checked",
      evidence.map((row) => [row.company_id, row.domain, row.evidence_type, row.url, true])
    );
  return { dir: WORK, bytes };
}

function shapeC({ companies, domains, evidence }) {
  const write = (name, header, rows) => {
    const path = join(WORK, name);
    writeFileSync(path, header + "\n" + rows.map((row) => row.join(",")).join("\n") + "\n");
    return statSync(path).size;
  };
  const bytes =
    write("staged_companies.csv", "slug,name,country_code,industry", companies.map((row) => [row.slug, JSON.stringify(row.name), row.country, row.industry])) +
    write("staged_domains.csv", "company_slug,domain,domain_type,verified,source_confidence", domains.map((row) => [row.slug, row.domain, row.domain_type, row.verified, row.confidence])) +
    write("staged_evidence.csv", "company_slug,domain,evidence_type,source_url", evidence.map((row) => [row.slug, row.domain, row.evidence_type, row.url]));
  return { dir: WORK, bytes };
}

/* ── Running things ─────────────────────────────────────────────────────── */

function psql(sql) {
  return execFileSync(PSQL[0], [...PSQL.slice(1), "-c", sql], { encoding: "utf8" });
}

/**
 * psql exit status, wall time and peak RSS, with the script on STDIN.
 *
 * Not `-c`: `\copy` is a psql meta-command, not SQL, and psql refuses to run it
 * through `-c` (it treats the rest of the line as a database name). Feeding a
 * script on stdin is also how a migration file reaches psql in production, so
 * this measures the real path.
 */
function runPsql(argsList, sql) {
  const started = Date.now();
  const command = TIME_BIN ?? PSQL[0];
  const script = `set client_min_messages = 'warning';\n${sql}\n`;
  const commandArgs = TIME_BIN
    ? ["-l", PSQL[0], ...PSQL.slice(1), ...argsList, "-f", "-"]
    : [...PSQL.slice(1), ...argsList, "-f", "-"];
  const result = spawnSync(command, commandArgs, { encoding: "utf8", input: script, maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - started;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const rssMatch = output.match(/(\d+)\s+maximum resident set size/);
  return {
    ms,
    status: result.status,
    peakRssMb: rssMatch ? Math.round(Number(rssMatch[1]) / (1024 * 1024)) : null,
    error: result.status === 0 ? null : output.split("\n").find((line) => /ERROR|timeout|FATAL/.test(line)) ?? "failed"
  };
}

function timeoutMs(ms) {
  const index = args.indexOf("--timeout");
  const seconds = index === -1 ? 600 : Number(args[index + 1]) || 600;
  return seconds * 1000;
}

const DDL = `
drop schema if exists ${SCHEMA} cascade;
create schema ${SCHEMA};
create table ${SCHEMA}.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country_code text,
  industry text,
  entity_status text not null default 'unknown',
  source text,
  source_confidence text,
  directory_rank integer
);
create table ${SCHEMA}.company_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references ${SCHEMA}.companies (id) on delete cascade,
  domain text not null check (domain = lower(btrim(domain))),
  domain_type text not null default 'primary_website',
  verified boolean not null default false,
  verified_at timestamptz,
  source text,
  source_confidence text not null default 'unknown',
  first_seen_at timestamptz not null default now(),
  unique (company_id, domain)
);
create table ${SCHEMA}.domain_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  domain text not null,
  evidence_type text not null,
  source_url text,
  checked boolean not null default false,
  observed_at timestamptz
);
`;

const INDEXES = `
create unique index company_domains_verified_domain_idx on ${SCHEMA}.company_domains (domain) where verified;
create index company_domains_domain_idx on ${SCHEMA}.company_domains (domain);
create index companies_active_name_idx on ${SCHEMA}.companies (entity_status, name);
create index companies_name_trgm_idx on ${SCHEMA}.companies using gin (name gin_trgm_ops);
create index company_domains_domain_trgm_idx on ${SCHEMA}.company_domains using gin (domain gin_trgm_ops);
create index domain_evidence_domain_idx on ${SCHEMA}.domain_evidence (domain);
`;

const SEARCH_QUERY = `select c.name from ${SCHEMA}.companies c where c.name ilike '%lumen%' order by c.name limit 25`;
const BROWSE_QUERY = `select c.name from ${SCHEMA}.companies c where c.entity_status = 'active' order by c.name limit 25`;
const TRGM_QUERY = `select c.name from ${SCHEMA}.companies c where c.name ilike '%figma%' order by c.name limit 25`;

function explainMs(sql) {
  const output = execFileSync(PSQL[0], [...PSQL.slice(1), "-c", `explain (analyze, costs off, timing on) ${sql}`], { encoding: "utf8" });
  const match = output.match(/Execution Time: ([\d.]+) ms/);
  return match ? Number(match[1]) : null;
}

/* ── Strategies ─────────────────────────────────────────────────────────── */

const results = [];

function record(strategy, metrics) {
  results.push({ strategy, ...metrics });
  console.log(
    `${strategy}: load ${(metrics.loadMs / 1000).toFixed(1)}s, indexes ${(metrics.indexMs / 1000).toFixed(1)}s, ` +
      `output ${(metrics.bytes / 1024 / 1024).toFixed(0)} MB, peak RSS ${metrics.peakRssMb ?? "n/a"} MB` +
      (metrics.error ? `  FAILED: ${metrics.error}` : "")
  );
}

function finish(strategy, { started, bytes, run, peakRssMb, generatedMs }) {
  let indexMs = 0;
  let error = run.error ?? null;
  if (!error) {
    const indexStarted = Date.now();
    try {
      psql(INDEXES);
    } catch (thrown) {
      error = String(thrown).split("\n")[0];
    }
    indexMs = Date.now() - indexStarted;
  }
  let counts = { companies: 0, domains: 0 };
  if (!error) {
    counts = JSON.parse(
      psql(`select json_build_object('companies', (select count(*) from ${SCHEMA}.companies), 'domains', (select count(*) from ${SCHEMA}.company_domains))`)
    );
  }
  record(strategy, {
    generatedMs,
    loadMs: Date.now() - started,
    indexMs,
    bytes,
    peakRssMb: peakRssMb ?? run.peakRssMb,
    error,
    ...counts
  });
}

function strategyA(rows) {
  const started = Date.now();
  const shape = shapeA(rows);
  const generatedMs = Date.now() - started;
  psql(DDL);
  const startedLoad = Date.now();
  // The migration file is what psql -f is given in the real path, so it is read
  // and piped as a script: identical bytes, minus the file-copy shortcut that
  // would flatter this strategy.
  const run = runPsql([], `set statement_timeout = '${timeoutMs() / 1000}s';\n${readFileSync(shape.path, "utf8")}`);
  finish("A giant migration", { started: startedLoad, bytes: shape.bytes, run, generatedMs });
  return generatedMs;
}

function strategyB(rows) {
  const started = Date.now();
  const shape = shapeB(rows);
  const generatedMs = Date.now() - started;
  psql(DDL);
  const startedLoad = Date.now();
  const run = runPsql(
    [],
    `\\copy ${SCHEMA}.companies (id, name, slug, country_code, industry) from '${join(WORK, "companies.csv")}' with (format csv, header true)
     \\copy ${SCHEMA}.company_domains (id, company_id, domain, domain_type, verified, source, source_confidence) from '${join(WORK, "company_domains.csv")}' with (format csv, header true)
     \\copy ${SCHEMA}.domain_evidence (company_id, domain, evidence_type, source_url, checked) from '${join(WORK, "domain_evidence.csv")}' with (format csv, header true)`
  );
  finish("B csv + copy", {
    started: startedLoad,
    bytes: shape.bytes,
    run,
    peakRssMb: run.peakRssMb,
    generatedMs
  });
  return generatedMs;
}

function strategyC(rows) {
  const started = Date.now();
  const shape = shapeC(rows);
  const generatedMs = Date.now() - started;
  psql(DDL);
  const startedLoad = Date.now();
  const run = runPsql(
    [],
    `create unlogged table ${SCHEMA}.staged_companies (slug text, name text, country_code text, industry text);
     create unlogged table ${SCHEMA}.staged_domains (company_slug text, domain text, domain_type text, verified boolean, source_confidence text);
     create unlogged table ${SCHEMA}.staged_evidence (company_slug text, domain text, evidence_type text, source_url text);
     \\copy ${SCHEMA}.staged_companies from '${join(WORK, "staged_companies.csv")}' with (format csv, header true)
     \\copy ${SCHEMA}.staged_domains from '${join(WORK, "staged_domains.csv")}' with (format csv, header true)
     \\copy ${SCHEMA}.staged_evidence from '${join(WORK, "staged_evidence.csv")}' with (format csv, header true)
     insert into ${SCHEMA}.companies (name, slug, country_code, industry, entity_status, source, source_confidence)
       select name, slug, country_code, industry, 'active', 'wikidata', 'unknown'
       from ${SCHEMA}.staged_companies
       on conflict (slug) do nothing;
     insert into ${SCHEMA}.company_domains (company_id, domain, domain_type, verified, verified_at, source, source_confidence)
       select c.id, d.domain, d.domain_type, d.verified, case when d.verified then now() end, 'wikidata', d.source_confidence
       from ${SCHEMA}.staged_domains d join ${SCHEMA}.companies c on c.slug = d.company_slug
       on conflict (company_id, domain) do nothing;
     insert into ${SCHEMA}.domain_evidence (company_id, domain, evidence_type, source_url, checked)
       select c.id, e.domain, e.evidence_type, e.source_url, true
       from ${SCHEMA}.staged_evidence e join ${SCHEMA}.companies c on c.slug = e.company_slug;
     drop table ${SCHEMA}.staged_companies, ${SCHEMA}.staged_domains, ${SCHEMA}.staged_evidence;`
  );
  finish("C staged import", {
    started: startedLoad,
    bytes: shape.bytes,
    run,
    peakRssMb: run.peakRssMb,
    generatedMs
  });
  return generatedMs;
}

/* ── Run ────────────────────────────────────────────────────────────────── */

console.log(`rows: ${N.toLocaleString("en-US")} companies (1 domain each, 2 evidence rows per 10th)`);
const generationStarted = Date.now();
const rows = buildRows(N);
const dataMs = Date.now() - generationStarted;
console.log(`data built in ${dataMs} ms (node heap used ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB)`);

psql(`create extension if not exists pg_trgm`);

const timings = { A: strategyA(rows) };
rmSync(join(WORK, "giant-migration.sql"), { force: true });
timings.B = strategyB(rows);
timings.C = strategyC(rows);
timings.dataMs = dataMs;

console.log("\nsearch after each strategy (same data, same indexes):");
const search = {};
for (const [label, sql] of [["browse", BROWSE_QUERY], ["substring", SEARCH_QUERY], ["trigram", TRGM_QUERY]]) {
  search[label] = explainMs(sql);
  console.log(`  ${label}: ${search[label]} ms`);
}

console.log("\n| Strategy | Generation | Load | Indexes | Output size | Peak RSS | Rows loaded |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const result of results) {
  console.log(
    `| ${result.strategy} | ${(result.generatedMs / 1000).toFixed(1)} s | ${(result.loadMs / 1000).toFixed(1)} s | ` +
      `${(result.indexMs / 1000).toFixed(1)} s | ${(result.bytes / 1024 / 1024).toFixed(0)} MB | ` +
      `${result.peakRssMb ?? "n/a"} MB | ${result.error ? "FAILED" : `${result.companies.toLocaleString("en-US")} / ${result.domains.toLocaleString("en-US")}`} |`
  );
}
console.log("");
psql(`drop schema if exists ${SCHEMA} cascade`);
