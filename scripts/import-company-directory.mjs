#!/usr/bin/env node

/**
 * Loads a generated company-directory export into the database.
 *
 *   PGHOST=… PGDATABASE=… PGUSER=… \
 *     node scripts/import-company-directory.mjs data/company-directory/prototype
 *
 *   flags:  --dry-run        stage and validate, then roll back
 *           --report <file>  write the JSON report here as well as to stdout
 *
 *   The export is `companies.csv`, `company_domains.csv` and
 *   `domain_evidence.csv`, plus `company_aliases.csv` and
 *   `company_relationships.csv` when a directory has them (both optional; the
 *   report says which were supplied).
 *
 *   COMPANY_IMPORT_DEBUG=1 additionally writes the generated psql script to
 *   /tmp/company-import-script.sql, which is how the missing semicolon in this
 *   file was found (see docs/company-directory-architecture.md §9).
 *
 * WHY THIS SHAPE, AND NOT A MIGRATION
 *   Measured (docs/company-directory-architecture.md §9): a single 170 MB
 *   migration for 500,000 rows costs ~1.8 GB of server memory, 24 seconds of
 *   CPU, and rolls back entirely on one bad row. The same rows as CSV copied
 *   into an UNLOGGED staging table and merged in one set-based statement cost
 *   ~234 MB (scripts/bench-company-directory.mjs). So:
 *
 *     source files → generator → CSV → unlogged staging → set-based merge
 *
 *   The migration history carries no seed at all any more — the v1 seed's
 *   migrations were removed from the repository, so a database built from it
 *   starts empty — and bulk data goes through here rather than through a
 *   migration. A database that already applied the old seed has it removed by
 *   the reset operation first (docs/company-directory-reset.md).
 *
 * WHAT IT WILL NOT DO
 *   * write `verified = true` — a row that claims it is REFUSED, because only a
 *     member's OTP verifies a domain (see the stewardship migration);
 *   * touch a domain a member has proved, or a company a member created: the
 *     merge skips them rather than overwriting, so an import can never take a
 *     domain away from the company that proved it;
 *   * delete anything, or drop a claim for disagreeing with another one;
 *   * invent a company for a domain whose company is missing — that row is
 *     reported as a rejected import, not silently merged;
 *   * hang an alias or a relationship on a company a member created, or delete a
 *     relationship the export no longer states: the import adds structure, and
 *     removing it is an operator's decision with an audit trail.
 *
 * THE DRY RUN
 *   `--dry-run` stages the export, validates every row, and rolls back. What it
 *   reports is the point of it: input rows per file, unique and duplicate
 *   companies, unique and duplicate domains (a domain two companies claim),
 *   companies with no domain, claims with no evidence behind them, rejected rows
 *   by reason, and ambiguous or unresolved identity matches. The same numbers
 *   are in the report on a real load, so a stage run and a load can be compared
 *   line by line before anyone commits.
 *
 * DETERMINISTIC IDS
 *   Company ids are UUIDv5 of the slug under a frozen namespace, computed here
 *   (not by the database), so the same input always produces the same ids:
 *   re-importing updates rows instead of adding duplicates, and the repository
 *   never stores ids it did not derive. The namespace is FROZEN: changing it
 *   re-imports the whole directory as new rows.
 *
 * IDEMPOTENT, SAFELY RETRYABLE
 *   Every statement is idempotent (`on conflict` with a guarded `do update`), so
 *   re-running after an interrupted load finishes the job and changes nothing
 *   that was already applied.
 *
 *   This is NOT checkpoint/resume: the load is one transaction, and an
 *   interruption rolls it back. What makes that safe is determinism plus
 *   idempotence — the company ids are derived from the same input every time, so
 *   the retry lands on the same rows — not a progress marker.
 *
 * COMPANY IDENTITY
 *   A company is recognised by the registry's own identifier (`source` +
 *   `source_id`) when the export carries one, and by slug otherwise. That is what
 *   lets a renamed company update in place instead of appearing twice, and what
 *   keeps two same-named companies in two jurisdictions two rows. The slug is a
 *   public handle and is never rewritten for an existing row.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

/** Frozen. See DETERMINISTIC IDS above before touching this. */
const COMPANY_NAMESPACE = "7b1c5f24-6a9e-5d3b-8c41-0e2f7a4b9d10";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const reportIndex = args.indexOf("--report");
const REPORT_PATH = reportIndex === -1 ? null : args[reportIndex + 1];
// The first argument that is neither a flag nor a flag's value.
const INPUT_DIR = resolve(
  positional.find((arg) => arg !== REPORT_PATH) ?? "."
);
/** Staged files are scratch: never written beside the inputs. */
const STAGED_DIR = join(tmpdir(), "company-directory-staged");

const PSQL = ["psql", "--quiet", "--no-psqlrc", "--no-align", "--tuples-only", "-v", "ON_ERROR_STOP=1"];

const STAGING = {
  companies: "_company_directory_stage",
  identity_map: "_company_identity_stage",
  domains: "_company_domain_stage",
  evidence: "_company_evidence_stage",
  aliases: "_company_alias_stage",
  relationships: "_company_relationship_stage",
  rejected: "_company_directory_rejected"
};

/** The kinds the tables accept. An export cannot invent a sixth one. */
const ALIAS_TYPES = ["alias", "former_name", "brand", "abbreviation", "transliteration"];
const RELATIONSHIP_TYPES = ["parent", "subsidiary", "brand", "division", "acquired_company", "former_name"];

/**
 * A claim is "evidenced" when its confidence is one a mailbox proof may act on
 * (`high`/`medium` — see the promotion threshold in the stewardship migration).
 * Everything else is a lead, and the dry run has to be able to say how many of
 * the export's claims are in each bucket before a single row is written.
 */
const EVIDENCED_CONFIDENCE = new Set(["high", "medium"]);

/* ── CSV reading (the generator writes simple RFC-4180-ish rows) ─────────── */

/**
 * The CSVs are generated by this repository, so a small parser is honest here:
 * it understands quoted fields and doubled quotes, and refuses anything else
 * rather than guessing.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) =>
      Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? "").trim()]))
    );
}

/** UUIDv5 (SHA-1), so the id is a pure function of the slug. */
export function uuidv5(value, namespace = COMPANY_NAMESPACE) {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(namespaceBytes).update(String(value), "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/* ── Staging ─────────────────────────────────────────────────────────────── */

const DDL = `
begin;
-- Every staging table the run creates is dropped first, so a rerun never
-- collides with what a previous run left behind (the tables are unlogged and
-- outlive the transaction deliberately: the report reads them after the merge).
drop table if exists ${STAGING.companies}, ${STAGING.domains}, ${STAGING.evidence},
  ${STAGING.aliases}, ${STAGING.relationships}, ${STAGING.rejected}, ${STAGING.identity_map};

create unlogged table ${STAGING.companies} (
  id uuid primary key,
  slug text not null,
  name text not null,
  country_code text,
  industry text,
  entity_status text not null default 'unknown',
  source text,
  source_id text,
  jurisdiction text,
  source_confidence text,
  directory_rank integer
);

-- What each staged row resolved to in the live table. The domains and evidence
-- join through this instead of through the slug, so a company recognised by its
-- registry number (whose live slug may differ from the export's) is still the
-- row the claims land on.
create unlogged table ${STAGING.identity_map} (
  stage_slug text primary key,
  company_id uuid not null,
  matched_by text not null
);

-- An empty CSV field arrives as an empty string, and "" is not "no identifier":
-- a comparison against it would match nothing by luck rather than by rule. Fold
-- every optional field to NULL once, here.
update ${STAGING.companies}
set country_code = nullif(country_code, ''),
    industry = nullif(industry, ''),
    source = nullif(source, ''),
    source_id = nullif(source_id, ''),
    jurisdiction = nullif(jurisdiction, ''),
    source_confidence = nullif(source_confidence, '');

create unlogged table ${STAGING.domains} (
  company_slug text not null,
  domain text not null,
  domain_type text not null,
  evidence_confidence text not null,
  source text
);

create unlogged table ${STAGING.evidence} (
  company_slug text not null,
  domain text not null,
  evidence_type text not null,
  source_url text,
  source text,
  checked boolean not null default false,
  observed_at timestamptz
);

-- Rejections are a table, not a log line: the run reports the count and the
-- reasons, and nothing is dropped without a record.
create unlogged table ${STAGING.aliases} (
  company_slug text not null,
  alias text not null,
  alias_type text not null default 'alias',
  source text
);

-- Structure, never ownership: a relationship row says who owns whom and nothing
-- about whose mail runs where (see the table's comment).
create unlogged table ${STAGING.relationships} (
  parent_slug text not null,
  child_slug text not null,
  relationship_type text not null,
  source text
);

create unlogged table ${STAGING.rejected} (
  source_file text not null,
  row_key text,
  reason text not null,
  detail text
);
`;

const MERGE = `
-- ── Companies, recognised by identity ─────────────────────────────────────
-- (1) The registry's own number decides when the export carries one, so a
-- company that has been renamed updates in place. The slug is deliberately NOT
-- rewritten: it is the public handle other things link to, and an import is not
-- a reason for a company's URL to change.
update public.companies as c
set name              = s.name,
    country_code      = coalesce(s.country_code, c.country_code),
    industry          = coalesce(s.industry, c.industry),
    jurisdiction      = coalesce(s.jurisdiction, c.jurisdiction),
    source            = coalesce(s.source, c.source),
    source_confidence = coalesce(s.source_confidence, c.source_confidence),
    directory_rank    = coalesce(s.directory_rank, c.directory_rank),
    entity_status     = case when c.entity_status = 'unknown' then s.entity_status else c.entity_status end
from ${STAGING.companies} as s
where s.source_id is not null
  and c.source = s.source
  and c.source_id = s.source_id
  and c.created_by is null;

-- (2) Rows without a registry identity, and identities this database has not
-- seen yet, go in by slug. A company a member created is left alone: the import
-- owns directory rows, not people's companies.
insert into public.companies as c (
  id, name, slug, country_code, industry, entity_status, source, source_id, jurisdiction,
  source_confidence, directory_rank
)
select s.id, s.name, s.slug, s.country_code, s.industry, s.entity_status,
       s.source, s.source_id, s.jurisdiction, s.source_confidence, s.directory_rank
from ${STAGING.companies} as s
where not exists (
  select 1 from public.companies as c
   where c.source_id is not null
     and s.source_id is not null
     and c.source = s.source
     and c.source_id = s.source_id
)
on conflict (slug) do update set
  country_code      = coalesce(excluded.country_code, c.country_code),
  industry          = coalesce(excluded.industry, c.industry),
  source            = coalesce(excluded.source, c.source),
  source_id         = coalesce(excluded.source_id, c.source_id),
  jurisdiction      = coalesce(excluded.jurisdiction, c.jurisdiction),
  source_confidence = coalesce(excluded.source_confidence, c.source_confidence),
  directory_rank    = coalesce(excluded.directory_rank, c.directory_rank),
  entity_status     = case when c.entity_status = 'unknown' then excluded.entity_status else c.entity_status end
where c.created_by is null;

-- (3) What each staged row became. Identity outranks the slug when the two
-- disagree, and a disagreement is reported rather than resolved silently.
insert into ${STAGING.identity_map} (stage_slug, company_id, matched_by)
select
  s.slug,
  coalesce(identity.id, by_slug.id),
  case when identity.id is not null then 'registry_identity' else 'slug' end
from ${STAGING.companies} as s
-- Two hash joins rather than one OR join: "a = b or c = d" cannot use an
-- and at 500,000 rows the nested loop it becomes is the whole load time.
left join public.companies as identity
  on identity.source = s.source and identity.source_id = s.source_id
left join public.companies as by_slug
  on by_slug.slug = s.slug
where coalesce(identity.id, by_slug.id) is not null
on conflict (stage_slug) do nothing;

-- ── Domain claims ─────────────────────────────────────────────────────────
-- Land on the row the staged company resolved to. A verified claim is never
-- touched: 'where not d.verified' on the update arm is what stops an import from
-- rewriting a proof, and the conflict target is the (company_id, domain) key,
-- not the domain.
insert into public.company_domains as d (
  company_id, domain, domain_type, evidence_confidence, source, verified
)
select m.company_id, s.domain, s.domain_type, s.evidence_confidence, s.source, false
from ${STAGING.domains} as s
join ${STAGING.identity_map} as m on m.stage_slug = s.company_slug
on conflict on constraint company_domains_company_domain_key do update set
  domain_type         = excluded.domain_type,
  evidence_confidence = excluded.evidence_confidence,
  source              = excluded.source
where not d.verified;

-- ── Aliases ──────────────────────────────────────────────────────────────
-- Search names, and the one place a merge would be tempting: a FORMER NAME
-- ("Facebook Inc.") must not collapse the Facebook brand entity into Meta
-- Platforms, which is why the type travels with the row instead of being
-- inferred from the string.
insert into public.company_aliases as a (company_id, alias, alias_type, source)
select m.company_id, s.alias, s.alias_type, s.source
from ${STAGING.aliases} as s
join ${STAGING.identity_map} as m on m.stage_slug = s.company_slug
-- A company a member created is theirs; the import does not hang names on it.
join public.companies as c on c.id = m.company_id and c.created_by is null
on conflict on constraint company_aliases_company_alias_key do update set
  alias_type = excluded.alias_type,
  source     = coalesce(excluded.source, a.source);

-- ── Relationships ──────────────────────────────────────────────────────────
-- Who owns whom. Insert-only: an acquisition that ends is a fact the export no
-- longer states, and this path is not the place to decide what that means — a
-- relationship is never deleted by an import, and never inferred from one.
insert into public.company_relationships as rel (
  parent_company_id, child_company_id, relationship_type, source
)
select p.company_id, k.company_id, s.relationship_type, s.source
from ${STAGING.relationships} as s
join ${STAGING.identity_map} as p on p.stage_slug = s.parent_slug
join ${STAGING.identity_map} as k on k.stage_slug = s.child_slug
join public.companies as pc on pc.id = p.company_id and pc.created_by is null
join public.companies as cc on cc.id = k.company_id and cc.created_by is null
where p.company_id <> k.company_id
on conflict on constraint company_relationships_unique do nothing;

-- ── Evidence ──────────────────────────────────────────────────────────────
-- Observations are added, never rewritten into agreement. Re-running the
-- import refreshes checked/observed_at on the same observation and inserts
-- nothing new.
insert into public.domain_evidence as e (
  company_id, domain, evidence_type, source_url, source, checked, observed_at
)
select m.company_id, s.domain, s.evidence_type, s.source_url, s.source, s.checked, s.observed_at
from ${STAGING.evidence} as s
join ${STAGING.identity_map} as m on m.stage_slug = s.company_slug
on conflict (company_id, domain, evidence_type, (coalesce(source_url, ''))) do update set
  checked     = excluded.checked,
  observed_at = coalesce(excluded.observed_at, e.observed_at);
`;

/* ── Build the staged files, validating as we go ─────────────────────────── */

export function stageRows({ companies, domains, evidence, aliases = [], relationships = [] }) {
  const rejected = [];
  const companyRows = [];
  const bySlug = new Map();

  for (const row of companies) {
    const slug = row.company_id;
    const name = row.company_name;
    if (!slug || !name) {
      rejected.push(["companies.csv", slug || name || "", "missing_slug_or_name", ""]);
      continue;
    }
    if (bySlug.has(slug)) {
      rejected.push(["companies.csv", slug, "duplicate_slug_in_export", bySlug.get(slug).name]);
      continue;
    }
    const staged = {
      id: uuidv5(slug),
      slug,
      name,
      country_code: row.country || "",
      industry: row.industry || "",
      entity_status: row.status || "unknown",
      source: row.source || "",
      source_id: row.source_id || "",
      jurisdiction: row.jurisdiction || "",
      source_confidence: row.source_confidence || "",
      directory_rank: row.directory_rank ? Number(row.directory_rank) : ""
    };
    bySlug.set(slug, staged);
    companyRows.push(staged);
  }

  const domainRows = [];
  for (const row of domains) {
    const slug = row.company_id;
    if (!bySlug.has(slug)) {
      // Never invent a company for a domain: a dangling claim would attribute
      // one company's domain to another.
      rejected.push(["company_domains.csv", `${slug}/${row.domain}`, "unknown_company", ""]);
      continue;
    }
    if (!DOMAIN_PATTERN.test(row.domain || "")) {
      rejected.push(["company_domains.csv", `${slug}/${row.domain}`, "invalid_domain", ""]);
      continue;
    }
    if (String(row.verified).toLowerCase() === "true") {
      // The one rule this importer exists to enforce: data never verifies.
      rejected.push(["company_domains.csv", `${slug}/${row.domain}`, "export_claims_verified", ""]);
      continue;
    }
    domainRows.push({
      company_slug: slug,
      domain: row.domain,
      domain_type: row.domain_type || "primary_website",
      evidence_confidence: row.evidence_confidence || "unknown",
      source: row.source || ""
    });
  }

  const evidenceRows = [];
  for (const row of evidence) {
    if (!bySlug.has(row.company_id)) {
      rejected.push(["domain_evidence.csv", `${row.company_id}/${row.domain}`, "unknown_company", ""]);
      continue;
    }
    if (!DOMAIN_PATTERN.test(row.domain || "")) {
      rejected.push(["domain_evidence.csv", `${row.company_id}/${row.domain}`, "invalid_domain", ""]);
      continue;
    }
    evidenceRows.push({
      company_slug: row.company_id,
      domain: row.domain,
      evidence_type: row.evidence_type,
      source_url: row.source_url || "",
      source: row.source || "",
      checked: String(row.checked).toLowerCase() === "true",
      observed_at: row.observed_at || ""
    });
  }

  const aliasRows = [];
  const seenAlias = new Set();
  for (const row of aliases) {
    const slug = row.company_id;
    const alias = (row.alias || "").trim();
    const aliasType = (row.alias_type || "alias").trim() || "alias";
    if (!bySlug.has(slug)) {
      rejected.push(["company_aliases.csv", `${slug}/${alias}`, "unknown_company", ""]);
      continue;
    }
    if (alias === "" || alias.length > 120) {
      rejected.push(["company_aliases.csv", `${slug}/${alias}`, "invalid_alias", ""]);
      continue;
    }
    if (!ALIAS_TYPES.includes(aliasType)) {
      rejected.push(["company_aliases.csv", `${slug}/${alias}`, "invalid_alias_type", aliasType]);
      continue;
    }
    const key = `${slug}\u0000${alias.toLowerCase()}`;
    if (seenAlias.has(key)) {
      rejected.push(["company_aliases.csv", `${slug}/${alias}`, "duplicate_alias_in_export", ""]);
      continue;
    }
    seenAlias.add(key);
    aliasRows.push({ company_slug: slug, alias, alias_type: aliasType, source: row.source || "" });
  }

  const relationshipRows = [];
  const seenRelationship = new Set();
  for (const row of relationships) {
    const parent = row.parent_company_id;
    const child = row.child_company_id;
    const type = (row.relationship_type || "").trim();
    if (!bySlug.has(parent) || !bySlug.has(child)) {
      // Never invent an entity to hang a relationship on: a dangling edge would
      // state who owns whom about a company this export never described.
      rejected.push(["company_relationships.csv", `${parent}->${child}`, "unknown_company", ""]);
      continue;
    }
    if (parent === child) {
      rejected.push(["company_relationships.csv", `${parent}->${child}`, "self_relationship", ""]);
      continue;
    }
    if (!RELATIONSHIP_TYPES.includes(type)) {
      rejected.push(["company_relationships.csv", `${parent}->${child}`, "invalid_relationship_type", type]);
      continue;
    }
    const key = `${parent}\u0000${child}\u0000${type}`;
    if (seenRelationship.has(key)) {
      rejected.push(["company_relationships.csv", `${parent}->${child}`, "duplicate_relationship_in_export", ""]);
      continue;
    }
    seenRelationship.add(key);
    relationshipRows.push({
      parent_slug: parent,
      child_slug: child,
      relationship_type: type,
      source: row.source || ""
    });
  }

  return { companyRows, domainRows, evidenceRows, aliasRows, relationshipRows, rejected };
}

/**
 * What the dry run has to be able to say about the export before anything is
 * written: how big it is, what it does not agree with itself about, and how much
 * of it is evidence rather than a lead. Pure — no database, no writes — so the
 * same numbers can be produced from a saved export in a test.
 */
export function datasetReport({
  companies = [],
  domains = [],
  evidence = [],
  aliases = [],
  relationships = [],
  staged
}) {
  const bySlug = new Map();
  let duplicateCompanies = 0;
  for (const row of companies) {
    const slug = row.company_id;
    if (!slug) continue;
    if (bySlug.has(slug)) {
      duplicateCompanies += 1;
      continue;
    }
    bySlug.set(slug, row);
  }

  const domainsPerCompany = new Map();
  const companiesPerDomain = new Map();
  let duplicateDomainRows = 0;
  const seenDomainPairs = new Set();
  for (const row of domains) {
    const slug = row.company_id;
    const domain = (row.domain || "").toLowerCase();
    if (!slug || !domain) continue;
    const pair = `${slug}\u0000${domain}`;
    if (seenDomainPairs.has(pair)) {
      duplicateDomainRows += 1;
      continue;
    }
    seenDomainPairs.add(pair);
    domainsPerCompany.set(slug, (domainsPerCompany.get(slug) ?? 0) + 1);
    if (!companiesPerDomain.has(domain)) companiesPerDomain.set(domain, new Set());
    companiesPerDomain.get(domain).add(slug);
  }

  const evidencedDomains = new Set();
  for (const row of evidence) {
    if (row.company_id && row.domain) evidencedDomains.add(`${row.company_id}\u0000${row.domain.toLowerCase()}`);
  }

  // A claim is under-evidenced when it is below the promotion threshold and no
  // observation was supplied for it. That is not an error — a website-only claim
  // is a legitimate lead — but it must be counted, because it is the number that
  // decides whether a proof at that domain can do anything at all. Counted per
  // (company, domain) claim, so a repeated row is a duplicate, not a second claim.
  const underEvidencedClaims = new Set();
  for (const row of domains) {
    const slug = row.company_id;
    const domain = (row.domain || "").toLowerCase();
    if (!slug || !domain) continue;
    const pair = `${slug}\u0000${domain}`;
    if (!EVIDENCED_CONFIDENCE.has(row.evidence_confidence || "unknown") && !evidencedDomains.has(pair)) {
      underEvidencedClaims.add(pair);
    }
  }

  let companiesWithoutDomains = 0;
  for (const slug of bySlug.keys()) {
    if (!domainsPerCompany.has(slug)) companiesWithoutDomains += 1;
  }

  const byReason = {};
  for (const [, , reason] of staged?.rejected ?? []) {
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }

  const domainOwners = [...companiesPerDomain.values()].filter((owners) => owners.size > 1);

  return {
    input_rows: {
      companies: companies.length,
      domains: domains.length,
      evidence: evidence.length,
      aliases: aliases.length,
      relationships: relationships.length,
      total: companies.length + domains.length + evidence.length + aliases.length + relationships.length
    },
    unique_companies: bySlug.size,
    duplicate_companies: duplicateCompanies,
    unique_domains: companiesPerDomain.size,
    duplicate_domains: domainOwners.length,
    duplicate_domain_rows: duplicateDomainRows,
    companies_without_domains: companiesWithoutDomains,
    domains_without_sufficient_evidence: underEvidencedClaims.size,
    rejected_rows: (staged?.rejected ?? []).length,
    rejected_by_reason: byReason,
    staged_rows: {
      companies: staged?.companyRows.length ?? 0,
      domains: staged?.domainRows.length ?? 0,
      evidence: staged?.evidenceRows.length ?? 0,
      aliases: staged?.aliasRows.length ?? 0,
      relationships: staged?.relationshipRows.length ?? 0
    }
  };
}

function copyList(rows, columns) {
  if (rows.length === 0) return "";
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => columns.map((column) => escape(row[column])).join(",")).join("\n");
  return `${columns.join(",")}\n${body}\n`;
}

/* ── Running psql ────────────────────────────────────────────────────────── */

function psql(script, { label }) {
  const result = spawnSync(PSQL[0], PSQL.slice(1), {
    encoding: "utf8",
    input: script,
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed:\n${detail}`);
  }
  return (result.stdout || "").trim();
}

function main() {
  const files = {
    companies: join(INPUT_DIR, "companies.csv"),
    domains: join(INPUT_DIR, "company_domains.csv"),
    evidence: join(INPUT_DIR, "domain_evidence.csv"),
    aliases: join(INPUT_DIR, "company_aliases.csv"),
    relationships: join(INPUT_DIR, "company_relationships.csv")
  };

  const read = (path) => {
    try {
      return parseCsv(readFileSync(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        console.error(`missing export file: ${path}`);
        process.exit(2);
      }
      throw error;
    }
  };

  /**
   * Aliases and relationships are optional feeds: the generator does not emit
   * them yet, and a stage run must not fail because a directory has no
   * corporate tree to state. Their absence is REPORTED rather than assumed.
   */
  const readOptional = (path) => {
    try {
      return { supplied: true, rows: parseCsv(readFileSync(path, "utf8")) };
    } catch (error) {
      if (error.code === "ENOENT") return { supplied: false, rows: [] };
      throw error;
    }
  };

  const started = Date.now();
  const companyRowsIn = read(files.companies);
  const domainRowsIn = read(files.domains);
  const evidenceRowsIn = read(files.evidence);
  const aliasFeed = readOptional(files.aliases);
  const relationshipFeed = readOptional(files.relationships);

  const staged = stageRows({
    companies: companyRowsIn,
    domains: domainRowsIn,
    evidence: evidenceRowsIn,
    aliases: aliasFeed.rows,
    relationships: relationshipFeed.rows
  });

  const dataset = datasetReport({
    companies: companyRowsIn,
    domains: domainRowsIn,
    evidence: evidenceRowsIn,
    aliases: aliasFeed.rows,
    relationships: relationshipFeed.rows,
    staged
  });

  const stagedDir = STAGED_DIR;
  mkdirSync(stagedDir, { recursive: true });
  writeFileSync(
    join(stagedDir, "companies.csv"),
    copyList(staged.companyRows, [
      "id", "slug", "name", "country_code", "industry",
      "entity_status", "source", "source_id", "jurisdiction",
      "source_confidence", "directory_rank"
    ])
  );
  writeFileSync(
    join(stagedDir, "domains.csv"),
    copyList(staged.domainRows, ["company_slug", "domain", "domain_type", "evidence_confidence", "source"])
  );
  writeFileSync(
    join(stagedDir, "evidence.csv"),
    copyList(staged.evidenceRows, [
      "company_slug", "domain", "evidence_type", "source_url", "source", "checked", "observed_at"
    ])
  );
  if (staged.aliasRows.length > 0) {
    writeFileSync(
      join(stagedDir, "aliases.csv"),
      copyList(staged.aliasRows, ["company_slug", "alias", "alias_type", "source"])
    );
  }
  if (staged.relationshipRows.length > 0) {
    writeFileSync(
      join(stagedDir, "relationships.csv"),
      copyList(staged.relationshipRows, ["parent_slug", "child_slug", "relationship_type", "source"])
    );
  }
  if (staged.rejected.length > 0) {
    writeFileSync(
      join(stagedDir, "rejected.csv"),
      copyList(
        staged.rejected.map(([source_file, row_key, reason, detail]) => ({ source_file, row_key, reason, detail })),
        ["source_file", "row_key", "reason", "detail"]
      )
    );
  }

  const copy = (table, file, columns) =>
    `\\copy ${table} (${columns.join(", ")}) from '${join(stagedDir, file)}' with (format csv, header true)`;

  const before = psql(
    `select json_build_object(
       'companies', (select count(*) from public.companies),
       'claims', (select count(*) from public.company_domains),
       'verified', (select count(*) from public.company_domains where verified),
       'evidence', (select count(*) from public.domain_evidence))`,
    { label: "reading the current size" }
  );

  const script = [
    DDL,
    copy(STAGING.companies, "companies.csv", [
      "id", "slug", "name", "country_code", "industry",
      "entity_status", "source", "source_id", "jurisdiction",
      "source_confidence", "directory_rank"
    ]),
    copy(STAGING.domains, "domains.csv", ["company_slug", "domain", "domain_type", "evidence_confidence", "source"]),
    copy(STAGING.evidence, "evidence.csv", [
      "company_slug", "domain", "evidence_type", "source_url", "source", "checked", "observed_at"
    ]),
    staged.aliasRows.length > 0
      ? copy(STAGING.aliases, "aliases.csv", ["company_slug", "alias", "alias_type", "source"])
      : "",
    staged.relationshipRows.length > 0
      ? copy(STAGING.relationships, "relationships.csv", ["parent_slug", "child_slug", "relationship_type", "source"])
      : "",
    staged.rejected.length > 0
      ? copy(STAGING.rejected, "rejected.csv", ["source_file", "row_key", "reason", "detail"])
      : "",
    MERGE,
    `select json_build_object(
       'database', current_database(),
       'companies_after', (select count(*) from public.companies),
       'claims_after', (select count(*) from public.company_domains),
       'verified_after', (select count(*) from public.company_domains where verified),
       'evidence_after', (select count(*) from public.domain_evidence),
       'aliases_after', (select count(*) from public.company_aliases),
       'relationships_after', (select count(*) from public.company_relationships),
       'companies_matched_by_registry_identity', (
         select count(*) from ${STAGING.identity_map} where matched_by = 'registry_identity'),
       'companies_that_changed_slug', (
         select count(*) from ${STAGING.companies} as s
         join ${STAGING.identity_map} as m on m.stage_slug = s.slug
         join public.companies as c on c.id = m.company_id
         where c.slug <> s.slug),
       'skipped_member_companies', (
         select count(*) from ${STAGING.companies} as s
         join public.companies as c on c.slug = s.slug
         where c.created_by is not null),
       'unresolved_companies', (
         select count(*) from ${STAGING.companies} as s
         where not exists (select 1 from ${STAGING.identity_map} as m where m.stage_slug = s.slug)),
       'ambiguous_company_matches', (
         select count(*) from ${STAGING.companies} as s
         join public.companies as identity
           on identity.source = s.source and identity.source_id = s.source_id
         join public.companies as by_slug
           on by_slug.slug = s.slug and by_slug.id <> identity.id),
       'skipped_verified_claims', (
         select count(*) from ${STAGING.domains} as s
         join ${STAGING.identity_map} as m on m.stage_slug = s.company_slug
         join public.company_domains as d on d.company_id = m.company_id and d.domain = s.domain
         where d.verified),
       'skipped_member_relationships', (
         select count(*) from ${STAGING.relationships} as s
         join ${STAGING.identity_map} as p on p.stage_slug = s.parent_slug
         join ${STAGING.identity_map} as k on k.stage_slug = s.child_slug
         join public.companies as pc on pc.id = p.company_id
         join public.companies as cc on cc.id = k.company_id
         where pc.created_by is not null or cc.created_by is not null),
       'rejected', (select count(*) from ${STAGING.rejected}));`,
    flags.has("--dry-run") ? "rollback;" : "commit;"
  ]
    .filter(Boolean)
    .join("\n");

  if (process.env.COMPANY_IMPORT_DEBUG) writeFileSync("/tmp/company-import-script.sql", script);
  const after = psql(script, { label: "importing the directory" });
  const measured = JSON.parse(after);

  const report = {
    input: INPUT_DIR,
    dry_run: flags.has("--dry-run"),
    staged: {
      companies: staged.companyRows.length,
      domains: staged.domainRows.length,
      evidence: staged.evidenceRows.length,
      aliases: staged.aliasRows.length,
      relationships: staged.relationshipRows.length,
      rejected: staged.rejected.length
    },
    // What the export says about itself, before any row is written. The dry run
    // is where these numbers are meant to be read: an import that only reports
    // after committing cannot be reviewed.
    dataset,
    feeds: {
      aliases: aliasFeed.supplied ? "supplied" : "not supplied",
      relationships: relationshipFeed.supplied ? "supplied" : "not supplied"
    },
    before: JSON.parse(before),
    after: measured,
    ms: Date.now() - started
  };

  console.log(JSON.stringify(report, null, 2));
  if (REPORT_PATH) writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  // Nothing is dropped silently: a rejected row is a bug in a layer or in the
  // export, and the exit status says so. The same goes for a company the load
  // could not resolve to exactly one live row — an ambiguous identity match is
  // the shape that would put one company's domains on another, so it fails the
  // run rather than passing quietly.
  if (staged.rejected.length > 0) process.exitCode = 1;
  if (measured.unresolved_companies > 0 || measured.ambiguous_company_matches > 0) {
    console.error(
      `company identity did not resolve cleanly: ${measured.unresolved_companies} unresolved, ` +
        `${measured.ambiguous_company_matches} ambiguous`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
