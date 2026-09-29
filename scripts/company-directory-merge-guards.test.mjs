/**
 * The directory importer's MERGE GUARDS, against seeded rows on a scratch
 * database: what happens when a company, a domain, an alias or a relationship
 * ALREADY exists and the export says something about it.
 *
 *   bash scripts/run-company-directory-scratch.sh scripts/company-directory-merge-guards.test.mjs
 *
 * WHY FIXTURES AND NOT THE 1,000-COMPANY EXPORT
 *   A generated export is a clean database: nothing is there yet, so every path
 *   that only fires on a SECOND import or on a row a MEMBER created is never
 *   reached. company-directory-roundtrip.test.mjs proves the full export is
 *   lossless; this file proves the merge is safe when it is not alone in the
 *   tables. Each case is a handful of hand-written rows against rows this file
 *   seeded, so the expected outcome is stated rather than derived.
 *
 * WHAT IT PINS (the importer's existing contract, not a new policy)
 *   * identity: `source` + `source_id` decides, the slug is never rewritten, and
 *     a disagreement is REPORTED (`companies_that_changed_slug`) rather than
 *     resolved silently;
 *   * an import never merges two companies by name, and never deletes a row it
 *     did not recognise;
 *   * a claim is always (company, domain): importing the same pair again updates
 *     it, and never duplicates it or moves it to another company;
 *   * `verified` is untouchable: a claimed-verified CSV row is REFUSED, and an
 *     existing verified row is neither downgraded nor duplicated;
 *   * a member-created company keeps its ROW, its ALIASES and its RELATIONSHIPS,
 *     while a domain claim and its evidence MAY be added to it - that is how the
 *     importer adopts a member's row instead of duplicating it, and the member's
 *     own proof still outranks whatever the directory says (three separate tests,
 *     because this is the asymmetry that matters);
 *   * a dangling feed row is rejected, never attached to a company by guesswork;
 *   * re-importing changes nothing.
 *
 * The scratch cluster comes from scripts/run-company-directory-scratch.sh, which
 * exports PGHOST/PGDATABASE/PGUSER. Without them this file FAILS rather than
 * skipping, and it refuses to run against a database whose name does not look
 * like the scratch one, because everything here WRITES.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { uuidv5 } from "./import-company-directory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORTER = join(ROOT, "scripts/import-company-directory.mjs");
const MAX_BUFFER = 64 * 1024 * 1024;

/* ── psql ────────────────────────────────────────────────────────────────── */

function psql(args) {
  return spawnSync("psql", ["--quiet", "--no-psqlrc", "--no-align", "--tuples-only", ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_BUFFER
  });
}

/** Rows as objects. json_agg, so no value can be corrupted by a delimiter. */
function query(sql) {
  const result = psql(["-v", "ON_ERROR_STOP=1", "-c", `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t`]);
  if (result.status !== 0) throw new Error(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  return JSON.parse(result.stdout.trim());
}

function exec(statement) {
  const result = psql(["-v", "ON_ERROR_STOP=1", "-c", statement]);
  if (result.status !== 0) throw new Error(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  return result.stdout.trim();
}

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Writes one export directory. A feed with no rows is written header-only. */
function writeExport(dir, files) {
  mkdirSync(dir, { recursive: true });
  const write = (name, header, rows) => {
    writeFileSync(join(dir, name), [header.join(","), ...rows.map((row) => row.map(csvValue).join(","))].join("\n") + "\n");
  };
  write(
    "companies.csv",
    ["company_id", "company_name", "country", "industry", "source", "source_id", "jurisdiction", "source_confidence", "directory_rank"],
    files.companies ?? []
  );
  write(
    "company_domains.csv",
    ["company_id", "domain", "domain_type", "verified", "source", "evidence_confidence"],
    files.domains ?? []
  );
  write(
    "domain_evidence.csv",
    ["company_id", "domain", "evidence_type", "source_url", "source", "checked"],
    files.evidence ?? []
  );
  write("company_aliases.csv", ["company_id", "alias", "alias_type", "source"], files.aliases ?? []);
  write(
    "company_relationships.csv",
    ["parent_company_id", "child_company_id", "relationship_type", "source"],
    files.relationships ?? []
  );
}

function runImport(dir, reportName) {
  const reportPath = join(dir, reportName);
  const result = spawnSync(process.execPath, [IMPORTER, "--report", reportPath, dir], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_BUFFER
  });
  // A refused import still commits and writes its report - that is how this
  // suite reads the reasons - so a missing report means it never got that far.
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new Error(`no import report at ${reportPath}: ${error.message}\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, report, stdout: result.stdout, stderr: result.stderr };
}

/* ── The rows this suite seeds ───────────────────────────────────────────── */

const MEMBER_USER = "00000000-0000-4000-8000-0000000000aa";
const SLUGS = [
  "acme-ltd",
  "globex",
  "wayne-holdings",
  "wayne-holdings-de",
  "initech",
  "acme-mail",
  "verified-co",
  "member-co",
  "member-proved"
];
const id = Object.fromEntries(SLUGS.map((slug) => [slug, uuidv5(slug)]));
const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

/** The export of a normal directory build, aimed at the rows seeded below. */
const FIXTURE_A = {
  companies: [
    ["acme-ltd", "Acme Ltd", "GB", "manufacturing", "companies_house", "12345678", "GB", "high", 1],
    ["globex", "Globex Corporation", "US", "software", "wikidata", "Q100", "US", "medium", 2],
    ["wayne-holdings", "Wayne Holdings", "GB", "holding", "wikidata", "", "GB", "unknown", 3],
    ["wayne-holdings-de", "Wayne Holdings", "DE", "holding", "wikidata", "", "DE", "unknown", 4],
    // Same registry number as the seeded `initech`, a different slug AND a
    // different jurisdiction: the registry's number decides, the slug is only
    // reported, and the jurisdiction never splits the entity.
    ["initech-corp", "Initech Corporation", "DE", "software", "companies_house", "99887766", "DE", "high", 5],
    ["acme-mail", "Acme Mail", "US", "mail", "curated", "", "US", "low", 6],
    ["verified-co", "Verified Co", "US", "retail", "curated", "", "US", "high", 7],
    ["member-co", "Directory Name For Member Co", "US", "software", "curated", "", "US", "low", 8],
    ["member-proved", "Directory Name For Member Proved", "US", "retail", "curated", "", "US", "low", 9]
  ],
  domains: [
    // scenario 4: the pair already exists
    ["acme-ltd", "acme.com", "primary_website", "false", "curated", "medium"],
    // scenario 6: an email claim stays an email claim
    ["acme-mail", "acme-mail.com", "corporate_email", "false", "curated", "low"],
    // scenario 5: a domain another company already claims
    ["globex", "shared-domain.com", "primary_website", "false", "wikidata", "unknown"],
    // scenario 7: an attempt to rewrite a verified claim
    ["verified-co", "verified-co.com", "corporate_email", "false", "wikidata", "low"],
    // a domain claim the directory ADDS to a member-created company (see the
    // note in the member-created tests: this is the adoption path)
    ["member-co", "member-co.com", "primary_website", "false", "curated", "low"],
    // an attempt to rewrite the claim the MEMBER proved, on a company the
    // member created: the strongest form of the protection
    ["member-proved", "member-proved.com", "primary_website", "false", "wikidata", "low"]
  ],
  evidence: [
    ["acme-ltd", "acme.com", "first_party_legal_page", "https://acme.example/contact", "curated", "true"],
    ["acme-ltd", "acme.com", "mx_record", "https://www.rfc-editor.org/rfc/rfc7483", "curated", "false"]
  ],
  aliases: [
    // scenario 9: already there
    ["acme-ltd", "Acme Limited", "former_name", "curated"],
    ["acme-ltd", "Acmecorp", "alias", "curated"],
    // the same alias string on a second company: uniqueness is (company, alias)
    ["acme-mail", "Acmecorp", "alias", "curated"],
    // must not be attached to a member's company
    ["member-co", "Member Alias", "alias", "curated"]
  ],
  relationships: [
    // scenario 10: already there
    ["acme-ltd", "globex", "parent", "curated"],
    // the other direction is a different authored edge, not a duplicate
    ["globex", "acme-ltd", "subsidiary", "curated"],
    // must not be attached to a member's company
    ["member-co", "globex", "parent", "curated"]
  ]
};

/** The two rows a clean export may never write, plus four dangling feeds. */
const FIXTURE_B = {
  companies: [["globex", "Globex Corporation", "US", "software", "wikidata", "Q100", "US", "medium", 2]],
  domains: [
    ["globex", "globex.com", "primary_website", "true", "wikidata", "high"],
    ["ghost-co", "ghost.com", "primary_website", "false", "curated", "low"]
  ],
  evidence: [["ghost-co", "ghost.com", "first_party_legal_page", "https://ghost.example/contact", "curated", "true"]],
  aliases: [["ghost-co", "Ghost", "alias", "curated"]],
  relationships: [["ghost-co", "globex", "parent", "curated"]]
};

/* ── What the database holds ─────────────────────────────────────────────── */

const COMPANIES_SQL = `
  select id::text as id, slug, name, country_code, industry, entity_status, source, source_id,
         jurisdiction, source_confidence, directory_rank, created_by::text as created_by, is_active
  from public.companies order by slug`;

const DOMAINS_SQL = `
  select c.slug as company_slug, d.domain, d.domain_type, d.evidence_confidence, d.source, d.verified,
         d.verified_at::text as verified_at
  from public.company_domains as d join public.companies as c on c.id = d.company_id
  order by d.domain, c.slug`;

const EVIDENCE_SQL = `
  select c.slug as company_slug, e.domain, e.evidence_type, e.source_url, e.source, e.checked,
         e.observed_at::text as observed_at
  from public.domain_evidence as e join public.companies as c on c.id = e.company_id
  order by e.domain, e.evidence_type`;

const ALIASES_SQL = `
  select c.slug as company_slug, a.alias, a.alias_type, a.source
  from public.company_aliases as a join public.companies as c on c.id = a.company_id
  order by a.alias, c.slug`;

const RELATIONSHIPS_SQL = `
  select p.slug as parent_slug, k.slug as child_slug, r.relationship_type, r.source
  from public.company_relationships as r
  join public.companies as p on p.id = r.parent_company_id
  join public.companies as k on k.id = r.child_company_id
  order by p.slug, k.slug, r.relationship_type`;

const SIDE_EFFECTS_SQL = `
  select
    (select count(*)::int from public.company_domains where verified)               as verified_claims,
    (select count(*)::int from public.company_members)                              as memberships,
    (select count(*)::int from public.company_email_verifications)                  as verifications,
    (select count(*)::int from public.companies)                                    as companies,
    (select count(*)::int from public.company_domains)                              as domains,
    (select count(*)::int from public.domain_evidence)                              as evidence,
    (select count(*)::int from public.company_aliases)                              as aliases,
    (select count(*)::int from public.company_relationships)                        as relationships`;

/** Everything this suite can move, as one comparable value. */
function snapshot() {
  return {
    sideEffects: query(SIDE_EFFECTS_SQL)[0],
    companies: query(COMPANIES_SQL),
    domains: query(DOMAINS_SQL),
    evidence: query(EVIDENCE_SQL),
    aliases: query(ALIASES_SQL),
    relationships: query(RELATIONSHIPS_SQL)
  };
}

/* ── The run ─────────────────────────────────────────────────────────────── */

const state = { dir: null, a: null, b: null, seeded: null, afterB: null };

before(() => {
  const missing = ["PGHOST", "PGDATABASE", "PGUSER"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not set. This suite needs a scratch PostgreSQL:\n` +
        `  bash scripts/run-company-directory-scratch.sh scripts/company-directory-merge-guards.test.mjs`
    );
  }
  // Everything below WRITES. A scratch cluster is the only safe place, so the
  // database's own name is checked before a single row is touched.
  const database = query("select current_database() as name")[0].name;
  if (!/^uxc/.test(database)) {
    throw new Error(
      `refusing to write to database "${database}": this suite seeds and imports rows, ` +
        `so it only runs against the scratch cluster (PGDATABASE=uxc_roundtrip).`
    );
  }

  // ── the seed ────────────────────────────────────────────────────────────
  exec(`
    insert into public.users (id, name, email, password_hash) values
      (${q(MEMBER_USER)}, 'Member', 'member@example.test', 'x')
    on conflict (id) do nothing;

    insert into public.companies
      (id, name, slug, country_code, industry, entity_status, source, source_id, jurisdiction, source_confidence, directory_rank, created_by) values
      (${q(id["acme-ltd"])}, 'Acme Ltd', 'acme-ltd', 'GB', 'manufacturing', 'active', 'companies_house', '12345678', 'GB', 'high', 99, null),
      (${q(id.globex)}, 'Globex', 'globex', null, null, 'unknown', null, null, null, null, null, null),
      (${q(id["wayne-holdings"])}, 'Wayne Holdings', 'wayne-holdings', 'GB', 'holding', 'active', null, null, 'GB', null, null, null),
      (${q(id.initech)}, 'Initech', 'initech', 'GB', 'software', 'active', 'companies_house', '99887766', 'GB', 'high', null, null),
      (${q(id["verified-co"])}, 'Verified Co', 'verified-co', 'US', 'retail', 'active', null, null, 'US', null, null, null),
      (${q(id["member-co"])}, 'Member Co', 'member-co', 'US', 'software', 'active', null, null, 'US', null, null, ${q(MEMBER_USER)}),
      (${q(id["member-proved"])}, 'Member Proved', 'member-proved', 'US', 'retail', 'active', null, null, 'US', null, null, ${q(MEMBER_USER)});

    insert into public.company_domains (company_id, domain, domain_type, evidence_confidence, source, verified, verified_at) values
      (${q(id["acme-ltd"])}, 'acme.com', 'primary_website', 'unknown', 'wikidata', false, null),
      (${q(id.initech)}, 'shared-domain.com', 'primary_website', 'unknown', 'wikidata', false, null),
      (${q(id["verified-co"])}, 'verified-co.com', 'primary_website', 'high', 'curated', true, now()),
      -- exactly the shape a member path writes: verified at the moment of proof
      (${q(id["member-proved"])}, 'member-proved.com', 'corporate_email', 'high', 'member_verification', true, now());

    insert into public.company_aliases (company_id, alias, alias_type, source) values
      (${q(id["acme-ltd"])}, 'Acme Limited', 'former_name', 'curated');

    insert into public.company_relationships (parent_company_id, child_company_id, relationship_type, source) values
      (${q(id["acme-ltd"])}, ${q(id.globex)}, 'parent', 'curated');
  `);
  // The verified row's timestamp must be exactly what it was, so it is captured
  // now and compared after the import.
  state.seeded = snapshot();

  const dir = mkdtempSync(join(tmpdir(), "uxc-merge-guards-"));
  state.dir = dir;

  // ── the guarded import ──────────────────────────────────────────────────
  const a = join(dir, "a");
  writeExport(a, FIXTURE_A);
  state.a = runImport(a, "report-a.json");
  // How each staged row resolved, read while this run's map is still the one in
  // the database: the next import drops and rebuilds it.
  state.identityA = query(`select stage_slug, matched_by from _company_identity_stage`);

  // ── the import that may only be refused ─────────────────────────────────
  const b = join(dir, "b");
  writeExport(b, FIXTURE_B);
  state.b = runImport(b, "report-b.json");
  state.afterB = snapshot();
});

/* ── 1. An existing company with the same identity ───────────────────────── */

test("an existing identity is updated, not duplicated, and keeps its UUID", () => {
  const rows = query(`select id::text as id, slug, name, source, source_id, jurisdiction, directory_rank
                      from public.companies where slug = 'acme-ltd'`);
  assert.equal(rows.length, 1, "no second company was created");
  assert.equal(rows[0].id, id["acme-ltd"], "the UUID is unchanged (and is uuidv5 of the slug)");
  assert.equal(rows[0].name, "Acme Ltd");
  assert.equal(rows[0].source, "companies_house");
  assert.equal(rows[0].source_id, "12345678");
  assert.equal(rows[0].jurisdiction, "GB");
  assert.equal(rows[0].directory_rank, 1, "the export's rank replaced the seeded one");

  // Which row the importer decided each staged company WAS.
  const matched = new Map(state.identityA.map((row) => [row.stage_slug, row.matched_by]));
  assert.equal(matched.get("acme-ltd"), "registry_identity", "the seated company was found by its number");
  assert.equal(matched.get("initech-corp"), "registry_identity");
  assert.equal(matched.get("member-co"), "slug");
  assert.equal(matched.get("wayne-holdings-de"), "slug");
  // The report counts three, not two: the identity map is built AFTER the
  // inserts, so `globex` - a row this very run created WITH a registry number -
  // is then matched by that number too. It is a counting nuance, not a second
  // company, and the row counts below prove that.
  assert.equal(state.a.report.after.companies_matched_by_registry_identity, 3);
  assert.equal(state.a.report.after.companies_after, 9);
});

/* ── 2. Unknown jurisdiction → known ─────────────────────────────────────── */

test("an unknown jurisdiction is filled in rather than duplicated", () => {
  const rows = query(`select id::text as id, slug, source, source_id, jurisdiction
                      from public.companies where slug = 'globex'`);
  assert.equal(rows.length, 1, "the seeded row was recognised by slug, not shadowed");
  assert.equal(rows[0].id, id.globex, "and it is still the deterministic UUIDv5 of the slug");
  assert.equal(rows[0].jurisdiction, "US", "the export's jurisdiction landed on the same row");
  assert.equal(rows[0].source, "wikidata");
  assert.equal(rows[0].source_id, "Q100");
});

/* ── 3. Two known, different jurisdictions ───────────────────────────────── */

test("two same-named companies in two known jurisdictions stay two companies", () => {
  const rows = query(`select id::text as id, slug, jurisdiction from public.companies where name = 'Wayne Holdings'`);
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  assert.deepEqual([...bySlug.keys()].sort(), ["wayne-holdings", "wayne-holdings-de"]);
  assert.equal(bySlug.get("wayne-holdings").jurisdiction, "GB");
  assert.equal(bySlug.get("wayne-holdings-de").jurisdiction, "DE");
  // Same name, two companies - so neither was collapsed into the other.
  assert.equal(bySlug.get("wayne-holdings").id, id["wayne-holdings"]);
  assert.equal(bySlug.get("wayne-holdings-de").id, id["wayne-holdings-de"]);
  // The importer has no name-matching step at all: a row is recognised by its
  // registry number or by its slug, so a shared name can never merge two rows.
  // (The name + known-jurisdiction rule lives in the generator's mergeDuplicates.)
});

test("a registry number outranks the jurisdiction, and a slug disagreement is reported", () => {
  // `companies_source_identity_idx` is `unique (source, source_id) where
  // source_id is not null`, so two rows CANNOT share a registry number. "Same
  // source_id, different jurisdiction" is therefore not two companies to keep
  // apart - it is ONE company whose descriptive fields the export owns. What
  // stays separate is two companies with the same NAME (above) or the same
  // DOMAIN (below).
  const rows = query(`select id::text as id, slug, name, jurisdiction from public.companies
                      where source = 'companies_house' and source_id = '99887766'`);
  assert.equal(rows.length, 1, "one registry number is one company, always");
  assert.equal(rows[0].id, id.initech, "the UUID is derived from the row's own slug");
  assert.equal(rows[0].slug, "initech", "and the slug is never rewritten by an import");
  assert.equal(rows[0].name, "Initech Corporation", "the export's name won");
  assert.equal(rows[0].jurisdiction, "DE", "the export's jurisdiction won");
  assert.equal(query(`select count(*)::int as n from public.companies where slug = 'initech-corp'`)[0].n, 0);
  assert.equal(state.a.report.after.companies_that_changed_slug, 1, "the disagreement is reported, not silently resolved");
});

/* ── 4. An existing domain claim for the same company ────────────────────── */

test("importing the same company/domain pair updates the claim instead of duplicating it", () => {
  const rows = query(`select d.company_slug, d.domain, d.domain_type, d.evidence_confidence, d.source
                      from (${DOMAINS_SQL}) as d where d.company_slug = 'acme-ltd' and d.domain = 'acme.com'`);
  assert.equal(rows.length, 1, "one row, not two");
  assert.equal(rows[0].evidence_confidence, "medium", "the export's confidence replaced the seeded one");
  assert.equal(rows[0].source, "curated");
});

/* ── 5. The same domain for a different company ──────────────────────────── */

test("a domain another company already claims is added as a second claim, never moved", () => {
  const rows = query(`select company_slug, domain_type, evidence_confidence, source, verified
                      from (${DOMAINS_SQL}) as d where d.domain = 'shared-domain.com' order by company_slug`);
  assert.equal(rows.length, 2, "both companies hold their own claim");
  assert.deepEqual(rows.map((row) => row.company_slug), ["globex", "initech"]);
  const initech = rows.find((row) => row.company_slug === "initech");
  assert.equal(initech.evidence_confidence, "unknown", "the existing claim is untouched");
  assert.equal(initech.source, "wikidata");
  assert.equal(initech.verified, false);
  const globex = rows.find((row) => row.company_slug === "globex");
  assert.equal(globex.evidence_confidence, "unknown");
  // Nothing was reassigned: the domain is not "stolen", it is disputed data.
  assert.equal(query(`select company_id::text as id from public.company_domains where domain = 'shared-domain.com' and company_id = ${q(id.initech)}`).length, 1);
});

/* ── 6. A website claim must not become an email claim ───────────────────── */

test("a website claim stays a website claim, and an email claim stays an email claim", () => {
  const acme = query(`select domain_type from (${DOMAINS_SQL}) as d where d.company_slug = 'acme-ltd' and d.domain = 'acme.com'`);
  assert.equal(acme[0].domain_type, "primary_website");
  const mail = query(`select domain_type from (${DOMAINS_SQL}) as d where d.company_slug = 'acme-mail' and d.domain = 'acme-mail.com'`);
  assert.equal(mail[0].domain_type, "corporate_email");
  // And no company holds one domain under two types.
  const both = query(`select count(*)::int as n from (
      select company_id, domain from public.company_domains group by company_id, domain having count(*) > 1
    ) as duplicates`);
  assert.equal(both[0].n, 0);
  const byType = query(`select domain_type, count(*)::int as n from public.company_domains group by domain_type order by domain_type`);
  assert.deepEqual(byType, [
    { domain_type: "corporate_email", n: 2 },
    { domain_type: "primary_website", n: 5 }
  ]);
});

/* ── 7. A verified claim is untouchable ──────────────────────────────────── */

test("an existing verified claim is neither downgraded, duplicated nor un-verified", () => {
  const seeded = state.seeded.domains.find((row) => row.domain === "verified-co.com");
  assert.equal(seeded.verified, true, "the fixture starts from a verified claim");
  const after = query(`select company_slug, domain_type, evidence_confidence, source, verified,
                              verified_at::text as verified_at
                       from (${DOMAINS_SQL}) as d where d.domain = 'verified-co.com'`);
  assert.equal(after.length, 1, "one claim, not two");
  assert.equal(after[0].verified, true, "still verified");
  assert.equal(after[0].verified_at, seeded.verified_at, "with the timestamp of the proof, not of the import");
  assert.equal(after[0].domain_type, "primary_website", "the export did not rewrite the type");
  assert.equal(after[0].evidence_confidence, "high", "nor the confidence");
  assert.equal(after[0].source, "curated", "nor the source");
  assert.equal(state.a.report.after.skipped_verified_claims, 2, "and the import says it skipped both");
});

test("a member's own proof survives an import that adopts their company", () => {
  // The strongest case: the company is the member's AND the claim is the
  // member's. The company's row is protected by `created_by`, and the claim by
  // `verified` - two guards, one row, and neither may move.
  const seeded = state.seeded.domains.find((row) => row.domain === "member-proved.com");
  assert.equal(seeded.verified, true, "the fixture starts from the member's proof");
  const after = query(`select d.company_slug, d.domain_type, d.evidence_confidence, d.source, d.verified,
                              d.verified_at::text as verified_at
                       from (${DOMAINS_SQL}) as d where d.domain = 'member-proved.com'`);
  assert.equal(after.length, 1, "one claim, not a directory claim beside the proof");
  assert.equal(after[0].verified, true, "still the member's proof");
  assert.equal(after[0].verified_at, seeded.verified_at, "with the timestamp of the proof");
  assert.equal(after[0].domain_type, "corporate_email", "the export's primary_website did not overwrite it");
  assert.equal(after[0].evidence_confidence, "high");
  assert.equal(after[0].source, "member_verification", "and the provenance still says who proved it");
  // The company row is untouched too.
  const company = query(`select name, created_by::text as created_by from public.companies where slug = 'member-proved'`);
  assert.deepEqual(company, [{ name: "Member Proved", created_by: MEMBER_USER }]);
});

/* ── 8. A CSV cannot create a verified claim ─────────────────────────────── */

test("an export that claims a domain is verified has the row refused", () => {
  const report = state.b.report;
  assert.equal(state.b.status, 1, "rejected rows fail the run");
  assert.equal(report.dataset.rejected_rows, 5);
  assert.deepEqual(report.dataset.rejected_by_reason, { unknown_company: 4, export_claims_verified: 1 });
  // `globex.com` was the row claiming verification: no claim may exist for it.
  assert.equal(query(`select count(*)::int as n from public.company_domains where domain = 'globex.com'`)[0].n, 0);
});

/* ── 9. Aliases ──────────────────────────────────────────────────────────── */

test("an alias is not added twice, and alias uniqueness is company-scoped", () => {
  const acmeAliases = query(`select alias, alias_type from (${ALIASES_SQL}) as a
                             where a.company_slug = 'acme-ltd' order by a.alias`);
  assert.deepEqual(acmeAliases, [
    { alias: "Acme Limited", alias_type: "former_name" },
    { alias: "Acmecorp", alias_type: "alias" }
  ]);
  // The same string on two companies is two rows: the key is (company, alias).
  const shared = query(`select company_slug from (${ALIASES_SQL}) as a where a.alias = 'Acmecorp'`);
  assert.deepEqual(shared.map((row) => row.company_slug).sort(), ["acme-ltd", "acme-mail"]);
});

test("an import does not hang names on a company a member created", () => {
  assert.equal(query(`select count(*)::int as n from public.company_aliases where alias = 'Member Alias'`)[0].n, 0);
  assert.equal(query(`select alias from public.company_aliases where company_id = ${q(id["member-co"])}`).length, 0);
  // The company row itself is the member's, too.
  const member = query(`select name, created_by::text as created_by, id::text as id from public.companies where slug = 'member-co'`);
  assert.equal(member.length, 1);
  assert.equal(member[0].name, "Member Co", "the export did not rename it");
  assert.equal(member[0].id, id["member-co"]);
  assert.equal(member[0].created_by, MEMBER_USER);
  assert.equal(state.a.report.after.skipped_member_companies, 2, "member-co and member-proved");
});

test("a directory domain claim IS added to a company a member created", () => {
  // The deliberate half of the asymmetry. `company_domains` and `domain_evidence`
  // carry no `created_by` guard, because a claim is directory DATA about a
  // domain: it never verifies, it grants no membership, and attaching it is how
  // the importer adopts a member's row rather than creating a second company for
  // the same slug (docs/company-directory-architecture.md, "What an import may
  // touch on a row that is somebody's").
  const memberClaims = query(`select domain, domain_type, evidence_confidence, source, verified
                             from (${DOMAINS_SQL}) as d where d.company_slug = 'member-co'`);
  assert.deepEqual(memberClaims, [
    {
      domain: "member-co.com",
      domain_type: "primary_website",
      evidence_confidence: "low",
      source: "curated",
      verified: false
    }
  ]);
  // And it cannot verify anything: the member's company gains a claim, not a proof.
  assert.equal(query(`select count(*)::int as n from public.company_members where company_id = ${q(id["member-co"])}`)[0].n, 0);
});

/* ── 10. Relationships ───────────────────────────────────────────────────── */

test("a relationship is not added twice, and the direction is preserved", () => {
  const rows = query(RELATIONSHIPS_SQL);
  assert.equal(rows.length, 2, "the seeded edge plus the one new edge");
  const parentEdge = rows.filter((row) => row.relationship_type === "parent");
  assert.deepEqual(parentEdge, [
    { parent_slug: "acme-ltd", child_slug: "globex", relationship_type: "parent", source: "curated" }
  ]);
  const inverse = rows.filter((row) => row.relationship_type === "subsidiary");
  assert.deepEqual(inverse, [
    { parent_slug: "globex", child_slug: "acme-ltd", relationship_type: "subsidiary", source: "curated" }
  ]);
  assert.equal(query(`select count(*)::int as n from public.company_relationships where parent_company_id = child_company_id`)[0].n, 0);
});

/* ── 11. Dangling feeds ──────────────────────────────────────────────────── */

test("a feed row whose company cannot be resolved is rejected, never attached", () => {
  assert.equal(query(`select count(*)::int as n from public.companies where slug like 'ghost%'`)[0].n, 0, "no company was invented");
  assert.equal(query(`select count(*)::int as n from public.company_domains where domain = 'ghost.com'`)[0].n, 0);
  assert.equal(query(`select count(*)::int as n from public.domain_evidence where domain = 'ghost.com'`)[0].n, 0);
  assert.equal(query(`select count(*)::int as n from public.company_aliases where alias = 'Ghost'`)[0].n, 0);
  assert.equal(
    query(`select count(*)::int as n from public.company_relationships r
           join public.companies c on c.id = r.parent_company_id or c.id = r.child_company_id
           where c.slug like 'ghost%'`)[0].n,
    0
  );
  // And nothing was attached to some OTHER company as a fallback.
  const report = state.b.report;
  assert.equal(report.dataset.input_rows.domains, 2);
  assert.equal(report.dataset.staged_rows.domains, 0, "neither domain row was staged");
  assert.equal(report.dataset.staged_rows.aliases, 0);
  assert.equal(report.dataset.staged_rows.relationships, 0);
});

test("the guarded import wrote exactly the rows it should, and no duplicates", () => {
  const counts = query(SIDE_EFFECTS_SQL)[0];
  assert.deepEqual(
    {
      companies: counts.companies,
      domains: counts.domains,
      evidence: counts.evidence,
      aliases: counts.aliases,
      relationships: counts.relationships
    },
    // 7 seeded companies + wayne-holdings-de + acme-mail;
    // 4 seeded claims + acme-mail.com + globex's shared-domain.com + member-co.com;
    // 2 observations; 1 seeded alias + 2 new; 1 seeded edge + 1 inverse.
    { companies: 9, domains: 7, evidence: 2, aliases: 3, relationships: 2 }
  );
});

/* ── 12. Idempotence ─────────────────────────────────────────────────────── */

test("importing the guarded export again changes nothing", () => {
  const before = JSON.stringify(state.afterB);
  const again = runImport(join(state.dir, "a"), "report-a2.json");
  assert.equal(again.status, 0, "the second import is clean");
  assert.equal(again.report.dataset.rejected_rows, 0);
  const after = snapshot();
  assert.equal(JSON.stringify(after), before, "the second import added or changed no row");
  for (const key of ["companies_after", "claims_after", "evidence_after", "aliases_after", "relationships_after", "verified_after"]) {
    assert.equal(again.report.after[key], state.a.report.after[key], `${key} is stable across runs`);
  }
});

/* ── 13. Deterministic identity ──────────────────────────────────────────── */

test("every company's id is uuidv5(slug), and one identity is one row", () => {
  const companies = query(`select id::text as id, slug, source, source_id from public.companies order by slug`);
  for (const row of companies) {
    assert.equal(row.id, uuidv5(row.slug), `${row.slug} keeps the id derived from its slug`);
  }
  // A registry identity never resolves to two rows: the partial unique index
  // makes it impossible, and the import reports a mismatch instead of guessing.
  const identities = query(`select source, source_id, count(*)::int as n from public.companies
                            where source_id is not null group by source, source_id having count(*) > 1`);
  assert.deepEqual(identities, []);
  assert.equal(state.a.report.after.ambiguous_company_matches, 0);
  assert.equal(state.a.report.after.unresolved_companies, 0);
});

/* ── 14. No verification side effects ────────────────────────────────────── */

test("the import verifies nothing and creates no membership", () => {
  const sideEffects = query(SIDE_EFFECTS_SQL)[0];
  assert.equal(sideEffects.verified_claims, 2, "exactly the two claims that were verified before");
  assert.equal(sideEffects.memberships, 0, "no membership was created");
  assert.equal(sideEffects.verifications, 0, "no pending verification was created");
  // The verified claims are the same rows, for the same companies.
  const verified = query(`select company_slug, domain from (${DOMAINS_SQL}) as d where d.verified order by d.domain`);
  assert.deepEqual(verified, [
    { company_slug: "member-proved", domain: "member-proved.com" },
    { company_slug: "verified-co", domain: "verified-co.com" }
  ]);
  assert.equal(state.a.report.after.verified_after, 2);
  assert.equal(state.b.report.after.verified_after, 2, "and the refused export changed nothing either");
});
