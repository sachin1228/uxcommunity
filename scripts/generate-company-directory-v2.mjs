/**
 * Builds the company directory from layered sources instead of one Wikidata
 * query, and keeps WEBSITE domains apart from EMPLOYEE EMAIL domains.
 *
 * WHY A SECOND GENERATOR EXISTS
 *   The v1 generator (removed from the repository together with the seed
 *   migration it wrote) asked Wikidata for one official website (P856) per
 *   organisation and stored that website's registrable domain as "the domain
 *   this company's work emails use". Wikidata P856 means "official website".
 *   It does not mean "employee email domain", and the two come apart exactly
 *   where the directory matters most: a holding company, a subsidiary, a brand,
 *   a conglomerate, a bank and a university can all have several domains that
 *   real employees receive mail on, and the website is often not one of them
 *   (Alphabet's site is abc.xyz; nobody has mail there). The v1 generator also
 *   dropped every organisation whose only domain is a bare country TLD
 *   (`example.de`, `example.in`, `example.io`), because its "truncated URL"
 *   heuristic cannot tell those from a mistake.
 *
 *   This script keeps the trust model untouched. It changes what a directory
 *   ROW means: a company, a domain, the type of that domain, and the evidence
 *   behind the pairing. `verified` is still false for everything a data file
 *   produces; only a member who receives and returns a code makes a domain
 *   verified.
 *
 * WHAT IT DOES
 *   1. Reads data/company-directory/*.json: the source registry
 *      (sources.json), the hand-curated entities with evidence
 *      (curated.json), and one or more discovery layers under seeds/.
 *   2. Normalises and validates every domain, and REJECTS the ones that cannot
 *      be a company's mail domain - consumer mailbox providers, subdomains
 *      that reduce to somebody else's registrable domain, and evidence of a
 *      kind that proves nothing (a redirect).
 *   3. Derives an email confidence (high/medium/low/unknown) from the TYPES of
 *      evidence a domain carries, never from a number typed into the file, and
 *      caps unchecked evidence at `low`.
 *   4. Resolves domain ownership: one domain has at most one owning company.
 *      A conflict is reported and left OWNERLESS, never silently assigned.
 *   5. Ranks the directory deterministically from documented fields, and admits
 *      in the output which basis the rank came from.
 *   6. Writes the five files of the export contract (below) and a coverage
 *      report. Nothing is written to supabase/migrations: this is the prototype
 *      stage, and the output is an artifact to review, not a seed to apply.
 *
 * THE EXPORT CONTRACT: ONE CANONICAL PLACE PER FACT
 *   scripts/import-company-directory.mjs reads these five files by header name.
 *   A fact lives in exactly one of them and nowhere else, so a column the
 *   importer ignores cannot drift out of agreement with the file it does read.
 *
 *     companies.csv              the entity: id, name, country, industry,
 *                                registry identity, rank. No domains, no aliases
 *                                and no parent column - each of those is a table
 *                                in the database, so each gets its own file.
 *     company_domains.csv        CANONICAL for every domain. The official
 *                                website and the employee email domain are both
 *                                CLAIMS here, told apart by `domain_type`, with
 *                                `evidence_confidence` and `source`.
 *     domain_evidence.csv        the observations behind a claim.
 *     company_aliases.csv        alias / former_name search names, typed.
 *     company_relationships.csv  parent / subsidiary / brand / division structure.
 *
 *   An employee email domain is NEVER inferred from a website domain: they are
 *   separate claim rows with separate evidence, and only curated evidence puts a
 *   domain in an email-bearing `domain_type`.
 *
 * HOW TO RUN
 *   node scripts/generate-company-directory-v2.mjs --sample 1000
 *       # build the 1,000-company prototype into data/company-directory/out
 *   node scripts/generate-company-directory-v2.mjs --check
 *       # validate only; non-zero exit when a layer is unusable
 *   node scripts/generate-company-directory-v2.mjs --sample 1000 --sql
 *       # also write the proposed migration (NOT into supabase/migrations)
 *
 * The output is deterministic: the same inputs produce byte-identical files,
 * which is what makes a reviewable diff possible at any directory size.
 *
 * THE SEED LAYER IS DATA, NOT A MIGRATION
 *   data/company-directory/seeds/wikidata-p856.json holds the v1 seed's 4,574
 *   (name, website domain) pairs. It was exported from the v1 seed migration
 *   before that migration was removed, and it is now the layer's only copy: the
 *   same file generates the directory and names the rows the directory reset
 *   removes (scripts/generate-company-directory-reset.mjs). There is no
 *   `--export-seed` any more, because there is no migration left to export from.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data/company-directory");
const SEED_DIR = join(DATA_DIR, "seeds");
// Not `out/`: a directory called out is ignored by the repository's .gitignore
// (it is where build output goes), and this directory is a reviewable artifact.
// Tests point COMPANY_DIRECTORY_OUT_DIR at a scratch directory so a run never
// rewrites the committed artifact and never writes into the working tree.
const OUT_DIR = process.env.COMPANY_DIRECTORY_OUT_DIR
  ? resolve(process.env.COMPANY_DIRECTORY_OUT_DIR)
  : join(DATA_DIR, "prototype");
const DOMAINS_SOURCE = join(ROOT, "apps/web/lib/companies/domains.ts");

/**
 * Domain types a company-domain row can carry. Exactly one of these is an
 * EMPLOYEE EMAIL domain claim; the rest describe a website, a brand or a
 * regional presence that happens to be owned by the company.
 */
const DOMAIN_TYPES = new Set([
  "primary_website",
  "corporate_email",
  "subsidiary_email",
  "brand",
  "subsidiary",
  "regional",
  "historical",
  "alias",
]);

/**
 * Types that can put the domain in `employee_email_domains`. `regional` counts
 * because a bank's country domain is often a real mailbox domain; it is only
 * admitted at medium confidence or better, since nothing but evidence
 * distinguishes "the UK site" from "the UK office's mail".
 */
const EMAIL_BEARING_TYPES = new Set(["corporate_email", "subsidiary_email", "regional"]);

/**
 * The vocabulary `company_relationships.relationship_type` accepts (migration
 * 150000). An export cannot invent a seventh one, so the generator refuses to
 * write a row the database would reject rather than letting the importer report
 * it as a rejected row later.
 */
const RELATIONSHIP_TYPES = ["parent", "subsidiary", "brand", "division", "acquired_company", "former_name"];

/** The layer every alias and every relationship in the export comes from. */
const CURATED_SOURCE = "curated";

/**
 * Layer entities that exist only to be a COUNTER-EXAMPLE: they document a rule
 * by being the case it must reject. They stay in the layer file so the tests and
 * the coverage report can name them, but they are filtered out before anything
 * is merged or written, because an export is a production candidate and a
 * knowingly fake company in the picker is worse than a missing one.
 *
 * The entity's `source` is the marker rather than a per-entity flag, so a
 * fixture cannot be half-configured: `sources.json` already registers this one
 * as "Counter-example fixture (not for production)".
 */
const FIXTURE_SOURCES = new Set(["example"]);

/** True when a layer record may reach the export. */
export function isProductionRecord(record) {
  return !FIXTURE_SOURCES.has(record.source);
}

/** Evidence kinds, with the weight each contributes and whether it may stand alone. */
const EVIDENCE_WEIGHTS = {
  // First-party: the company published the address on its own property.
  first_party_role_address: 2,
  first_party_legal_page: 2,
  first_party_security_txt: 2,
  first_party_document: 2,
  first_party_careers_contact: 1,
  published_email_format: 1,
  // Third-party but citable.
  external_reputable: 1,
  // Supporting only: proves mail infrastructure exists, never that employees
  // use the domain. Cannot lift a domain above `medium` on its own.
  mx_record: 1,
  ct_certificate: 1
};

const SUPPORTING_ONLY = new Set(["mx_record", "ct_certificate"]);

/**
 * Evidence that must never be accepted. A redirect from a domain to a
 * company's website says the domain is pointed at the company, which is a
 * marketing decision or a parked-domain default - not proof of a mailbox.
 */
const FORBIDDEN_EVIDENCE = new Set(["redirect_from_website", "website_domain_match", "mx_only"]);

/**
 * Domains that host OTHER people's presence, used ONLY when the domain came
 * from a website field. A curated, evidence-backed email domain is never
 * subject to this list: google.com is Google's own mail domain, and the v1
 * deny list deleted Google, LinkedIn, TikTok, Pinterest and X from the
 * directory for exactly that confusion.
 *
 * The list cannot be applied on its own, because the same domain is a
 * platform AND the operator's own site. So it only rejects when the entity's
 * name has nothing to do with the domain: "Facebook" with facebook.com is the
 * company, "Acme Retail" with facebook.com is a shop whose only web presence
 * is a page somebody else owns.
 */
const PLATFORM_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linkedin.com",
  "tiktok.com",
  "weibo.com",
  "vk.com",
  "pinterest.com",
  "snapchat.com",
  "tumblr.com",
  "medium.com",
  "substack.com",
  "patreon.com",
  "wikipedia.org",
  "wikidata.org",
  "wikimedia.org",
  "archive.org",
  "wordpress.com",
  "blogspot.com",
  "weebly.com",
  "wix.com",
  "wixsite.com",
  "squarespace.com",
  "carrd.co",
  "linktr.ee",
  "beacons.ai",
  "github.io",
  "sites.google.com",
  "docs.google.com",
  "forms.gle",
  "altervista.org",
  "blogger.com",
  "geocities.com",
  "angelfire.com",
  "tripod.com"
]);

/** Two-part suffixes (`co.uk`, `com.au`) where the registrable domain has three labels. */
const SECOND_LEVEL_LABELS = new Set([
  "co",
  "com",
  "net",
  "org",
  "gob",
  "gov",
  "edu",
  "ac",
  "gen",
  "firm",
  "ind",
  "ltd",
  "plc",
  "mil",
  "sch",
  "res"
]);

/**
 * TLDs the v1 generator refuses. Kept as policy here but NOT as a silent
 * filter - a refused domain is reported with its reason, because a university
 * or a government body is a real employer whose staff hold real institutional
 * addresses, and that is a product decision rather than a data defect.
 */
const NON_COMPANY_TLDS = new Set(["gov", "mil", "edu", "int", "arpa"]);

const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/* ---------------------------------------------------------------------------
 * Domain shaping
 * ------------------------------------------------------------------------ */

/**
 * Mirrors normalizeDomain in apps/web/lib/companies/domains.ts, so a domain
 * this script accepts is a domain the app will accept too.
 */
export function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at !== -1) value = value.slice(at + 1);
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0].split("?")[0].split("#")[0];
  value = value.split("@").pop() ?? value;
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/\.+$/, "");
  if (!DOMAIN_PATTERN.test(value)) return null;
  return value;
}

/**
 * The registrable domain of a host: `mail.acme.co.uk` → `acme.co.uk`.
 *
 * Two-part suffixes are the trap here: `hsbc.com.hk`, `anz.com.au` and
 * `icbc.com.cn` all keep THREE labels, and the second-level label is `com`,
 * not a two-letter one. A rule that only looks for `co`/`ac` reduces those to
 * `com.hk` and then rejects the real domain as a subdomain of a country code.
 * The real answer is the public suffix list; until this script carries one, the
 * suffix set is the approximation and it is stated as such.
 */
export function registrableDomain(host) {
  const value = normalizeDomain(host);
  if (!value) return null;
  const labels = value.split(".");
  if (labels.length <= 2) return value;
  const second = labels[labels.length - 2];
  const tld = labels[labels.length - 1];
  // A country-code TLD with a known second-level registry label: `co.uk`,
  // `com.au`, `ac.in`, `com.br`. Anything else keeps the last two labels.
  const keep = tld.length === 2 && SECOND_LEVEL_LABELS.has(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** The free/personal provider list the app enforces, read from the app itself. */
export function freeEmailDomains() {
  const source = readFileSync(DOMAINS_SOURCE, "utf8");
  const block = source.match(/FREE_EMAIL_DOMAINS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error(`FREE_EMAIL_DOMAINS not found in ${DOMAINS_SOURCE}`);
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/**
 * Every reason a candidate domain cannot be used, as a list of codes. Returning
 * all of them (rather than the first) is what makes the coverage report able to
 * say WHY a layer lost rows.
 */
export function domainProblems(domain, { source, freeEmail, name = null, reduce = true } = {}) {
  const problems = [];
  const normalised = normalizeDomain(domain);
  if (!normalised) return { domain: null, problems: ["not_a_domain"] };

  const registrable = reduce ? registrableDomain(normalised) : normalised;
  if (registrable !== normalised) problems.push("subdomain_not_ownable");
  if (freeEmail.has(registrable)) problems.push("free_email_provider");
  const tld = registrable.split(".").pop();
  if (NON_COMPANY_TLDS.has(tld)) problems.push("non_company_tld");
  // The platform list is a website-resolution rule: it says "a social profile
  // is not a company's site", not "this company does not own this domain". A
  // name that matches the domain is the company that runs the platform.
  if (source === "website" && PLATFORM_DOMAINS.has(registrable) && !nameRelatesToDomain(name, registrable)) {
    problems.push("platform_not_a_company_site");
  }
  return { domain: registrable, problems };
}

/**
 * Does the name plausibly describe the domain? This is a QUALITY SIGNAL, not a
 * proof of ownership - Tata Consultancy Services / tcs.com is a real match
 * through initials, and Acme Technologies / acmetech.io is a string accident
 * that proves nothing. The only place the pipeline acts on it is the platform
 * rule above, where being wrong costs a review flag rather than a domain.
 */
export function nameRelatesToDomain(name, domain) {
  if (!name || !domain) return false;
  const legal = new Set([
    "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "company",
    "gmbh", "pte", "plc", "sa", "ag", "bv", "nv", "srl", "group", "holdings"
  ]);
  const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !legal.has(word));
  if (words.length === 0) return false;
  const labels = domain.split(".").slice(0, -1).flatMap((label) => label.split("-"));
  const compact = words.join("");
  const initials = words.map((word) => word[0]).join("");
  const related = (a, b) => a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
  return labels.some((label) => related(label, compact) || related(label, initials) || words.includes(label));
}

/* ---------------------------------------------------------------------------
 * Evidence and confidence
 * ------------------------------------------------------------------------ */

/**
 * Derives the confidence tier from evidence kinds. The file never states a
 * confidence: a number typed next to a domain is an assertion, and the whole
 * point of the column is to record what was actually observed.
 *
 *   high     at least two first-party-weight points AND a first-party kind
 *   medium   any first-party kind, or two points from weaker kinds
 *   low      one point, or supporting evidence only
 *   unknown  no evidence at all - a website domain is not email evidence
 */
export function confidenceFromEvidence(evidence = [], { checked = false } = {}) {
  const kinds = evidence.map((entry) => entry.type);
  const forbidden = kinds.filter((kind) => FORBIDDEN_EVIDENCE.has(kind));
  if (forbidden.length > 0) return { tier: "unknown", score: 0, kinds, refused: forbidden };

  const score = kinds.reduce((sum, kind) => sum + (EVIDENCE_WEIGHTS[kind] ?? 0), 0);
  const hasFirstParty = kinds.some((kind) => kind.startsWith("first_party_"));
  const hasNonSupporting = kinds.some((kind) => !SUPPORTING_ONLY.has(kind));

  let tier;
  if (score === 0 || !hasNonSupporting) tier = score === 0 ? "unknown" : "low";
  else if (score >= 4 && hasFirstParty) tier = "high";
  else if (score >= 2) tier = "medium";
  else tier = "low";

  // Unchecked evidence cannot exceed `low`: nobody has opened the source, so
  // the domain is a lead rather than a finding.
  if (!checked && tier !== "unknown") tier = "low";

  return { tier, score, kinds, refused: [] };
}

const TIER_ORDER = { high: 4, medium: 3, low: 2, unknown: 1 };

/* ---------------------------------------------------------------------------
 * Loading the layers
 * ------------------------------------------------------------------------ */

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadSources() {
  const registry = readJson(join(DATA_DIR, "sources.json"));
  const licensing = existsSync(join(DATA_DIR, "licensing.json")) ? readJson(join(DATA_DIR, "licensing.json")) : { sources: {} };
  const sources = new Map(
    registry.sources.map((source) => {
      const terms = licensing.sources?.[source.id] ?? {};
      return [source.id, { ...source, redistribution_allowed: terms.redistribution, derived_data_committable: terms.committable }];
    })
  );
  // The curated layers are not licensed datasets, so they are not in the
  // registry - but they still have to be declared somewhere, or the pipeline
  // cannot tell "no evidence and no licence to check" from "source I have
  // never heard of".
  sources.set("curated", {
    id: "curated",
    name: "Hand-curated (this repository)",
    license: "n/a - per-row evidence URLs, reviewed by whoever edits data/company-directory/curated.json",
    status: "adopted"
  });
  sources.set("example", {
    id: "example",
    name: "Counter-example fixture (not for production)",
    license: "n/a",
    status: "adopted"
  });
  return sources;
}

export function loadCurated() {
  const path = join(DATA_DIR, "curated.json");
  return existsSync(path) ? readJson(path).entities : [];
}

/**
 * Explicit mail delegations: "entity X accepts mailboxes on a domain that
 * another entity stewards". This is the ONLY way a subsidiary can verify its
 * staff on a parent's domain, and it is never inferred - a relationship says
 * who owns whom, not whose mailboxes are acceptable.
 */
export function loadDelegations() {
  const path = join(DATA_DIR, "curated.json");
  if (!existsSync(path)) return [];
  return (readJson(path).delegations ?? []).map((delegation) => ({
    ...delegation,
    domain: normalizeDomain(delegation.domain),
    effective: isDelegationEffective(delegation)
  }));
}

/**
 * A delegation only counts once someone has opened its evidence. An unreviewed
 * delegation is recorded and reported, and grants nothing - the same rule as
 * an unchecked evidence row, because it has the same failure mode.
 */
export function isDelegationEffective(delegation) {
  if (!delegation || delegation.review_status === "rejected") return false;
  if (!delegation.evidence_checked) return false;
  const kinds = (delegation.evidence ?? []).map((entry) => entry.type);
  return kinds.some((kind) => !SUPPORTING_ONLY.has(kind) && kind in EVIDENCE_WEIGHTS);
}

export function loadSeeds(directory = SEED_DIR) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJson(join(directory, file)));
}

/**
 * Normalises one entity from any layer into the internal shape. The layers
 * differ only in what they know, so the differences are resolved here rather
 * than in every consumer.
 */
export function toCompany(record, { layer, freeEmail, sources }) {
  const issues = [];
  const problems = [];
  const source = sources.get(record.source);
  if (record.source && !source) issues.push(`unknown_source:${record.source}`);
  if (source && source.status !== "adopted" && layer !== "curated") {
    issues.push(`source_not_adopted:${record.source}`);
  }

  const domains = [];
  for (const raw of record.domains ?? []) {
    const fromWebsite = layer === "seed" || raw.domain_type === "primary_website";
    const checked = domainProblems(raw.domain, {
      source: fromWebsite ? "website" : "company",
      freeEmail,
      name: record.name
    });
    // An unusable domain and an unknown type are different defects, so both are
    // reported before the row is dropped: the first is a data problem, the
    // second is a schema problem, and hiding either makes a layer look clean.
    const typeUnknown = Boolean(raw.domain_type) && !DOMAIN_TYPES.has(raw.domain_type);
    if (typeUnknown) issues.push(`unknown_domain_type:${raw.domain_type}`);
    if (checked.problems.length > 0) {
      problems.push({ domain: checked.domain ?? raw.domain, reasons: checked.problems });
      continue;
    }
    if (typeUnknown) continue;
    const evidence = raw.evidence ?? [];
    const confidence = confidenceFromEvidence(evidence, { checked: Boolean(raw.evidence_checked) });
    if (confidence.refused.length > 0) {
      problems.push({ domain: checked.domain, reasons: confidence.refused.map((kind) => `forbidden_evidence:${kind}`) });
      continue;
    }
    // An evidence kind nobody has defined contributes no weight, which would
    // make a layer look confident while recording a typo. It is a layer bug.
    for (const kind of confidence.kinds) {
      if (!(kind in EVIDENCE_WEIGHTS)) issues.push(`unknown_evidence_type:${kind}`);
    }
    const companyId = record.id ?? slugify(record.name);
    domains.push({
      domain: checked.domain,
      domain_type: raw.domain_type ?? "primary_website",
      verified: false,
      source: record.source ?? layer,
      source_url: raw.source_url ?? record.source_url ?? null,
      confidence: confidence.tier,
      evidence_count: evidence.length,
      evidence_kinds: confidence.kinds.slice().sort(),
      evidence_checked: Boolean(raw.evidence_checked),
      // One row per observation, because the claim is what the app verifies
      // against but the observations are what a re-check, a correction or an
      // audit has to look at. See domain_evidence in the architecture doc.
      evidence: evidence.map((entry) => ({
        company_id: companyId,
        domain: checked.domain,
        evidence_type: entry.type ?? "unknown",
        source_url: entry.url ?? null,
        // Which layer the observation came from. `domain_evidence.source` is a
        // column in the database and the importer writes it, so the feed has to
        // carry it or provenance dies at the CSV boundary.
        source: raw.source ?? record.source ?? layer,
        checked: Boolean(raw.evidence_checked)
      }))
    });
  }

  // The website the entity declares. It is kept as a fact about the company
  // even when it is a subdomain (`aws.amazon.com`) or a platform page, because
  // both are things a picker wants to show - what it must NOT become is a
  // domain row this company owns. Ownership is what the `domains` rows say.
  const website = normalizeDomain(record.website_domain);
  const websiteCheck = domainProblems(record.website_domain, { source: "website", freeEmail, name: record.name });
  const websiteCovered = websiteCheck.domain !== null && domains.some((row) => row.domain === websiteCheck.domain);
  if (website && !websiteCovered) {
    if (websiteCheck.problems.length > 0) {
      problems.push({ domain: websiteCheck.domain ?? website, reasons: websiteCheck.problems });
    } else {
      domains.push({
        domain: websiteCheck.domain,
        domain_type: "primary_website",
        verified: false,
        source: record.source ?? layer,
        source_url: record.source_url ?? null,
        confidence: "unknown",
        evidence_count: 0,
        evidence_kinds: [],
        evidence_checked: false
      });
    }
  }

  const emailDomains = domains.filter(
    (row) =>
      EMAIL_BEARING_TYPES.has(row.domain_type) &&
      (row.confidence === "high" ||
        row.confidence === "medium" ||
        // `regional` needs more than a single unchecked point to claim mail.
        (row.domain_type !== "regional" && row.confidence === "low"))
  );

  const best = domains.reduce(
    (top, row) => (TIER_ORDER[row.confidence] > TIER_ORDER[top] ? row.confidence : top),
    "unknown"
  );

  return {
    company: {
      id: record.id ?? slugify(record.name),
      name: record.name,
      normalized_name: record.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      // Identity and search names. `former_names` are search-only: "Facebook
      // Inc." finds Meta, and must never turn the Facebook brand entity into
      // part of Meta Platforms (or the other way round).
      aliases: (record.aliases ?? []).slice().sort(),
      former_names: (record.former_names ?? []).slice().sort(),
      country: record.country ?? null,
      industry: record.industry ?? null,
      status: record.status ?? "unknown",
      website_domain: website,
      source: record.source ?? layer,
      // A registry's own identifiers. A name is a label, not an identity: two
      // companies called "Nordic Holdings Ltd" in two jurisdictions are two
      // companies, and `source` + `source_id` is the only thing that says so.
      source_id: record.source_id ?? null,
      jurisdiction: record.jurisdiction ?? record.country ?? null,
      source_confidence: record.source_confidence ?? null,
      sitelinks: record.sitelinks ?? 0,
      domains,
      email_domains: emailDomains.map((row) => row.domain).sort(),
      best_confidence: best,
      email_evidence_score: emailDomains.reduce((sum, row) => sum + row.evidence_count, 0),
      layer,
      issues,
      // The same domain can be reached through a declared website and a domain
      // row; reporting it twice would make the coverage counts lie.
      problems: dedupeProblems(problems)
    },
    problems: dedupeProblems(problems)
  };
}

function dedupeProblems(problems) {
  const seen = new Set();
  return problems.filter((problem) => {
    const key = `${problem.domain}|${problem.reasons.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Company names that mean the same entity, after the words that describe a
 * legal form are dropped: "Alphabet Inc." and "Alphabet" are one company, and
 * treating them as two is how a directory grows five rows for one employer.
 */
export function matchKey(name) {
  const legal = new Set([
    "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "company",
    "gmbh", "pte", "plc", "sa", "ag", "bv", "nv", "srl", "co"
  ]);
  const words = String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (words.length > 1 && legal.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * Merges entities that are the same company, keeping the curated record (it
 * carries the evidence, the aliases and the relationships) and folding the
 * discovery row's domains into it. Nothing is deleted silently: a merge is
 * counted, and the domains of the merged row survive as website hints.
 */
export function mergeDuplicates(companies) {
  const order = { curated: 0, seed: 1 };
  const sorted = companies.slice().sort((a, b) => (order[a.layer] ?? 9) - (order[b.layer] ?? 9) || a.id.localeCompare(b.id));
  // Identity, in order of authority:
  //
  //   1. the registry identity — `source` + `source_id`. Two rows with the same
  //      one are the same legal entity whatever they are called;
  //   2. the name with its legal suffix dropped, WITHIN one jurisdiction, plus
  //      every alias. Two rows whose names match but whose KNOWN jurisdictions
  //      are different countries are NOT merged: that is exactly the merge that
  //      folded same-named companies in different countries into one.
  //
  // A jurisdiction that is UNKNOWN is not a different jurisdiction. A discovery
  // row (Wikidata supplies a name and a website, nothing else) carries no
  // country at all, and treating that silence as a country of its own left
  // "Alphabet Inc." (curated, US) and "Alphabet Inc." (Wikidata, no country)
  // standing as two companies in the picker, each claiming abc.xyz.
  //
  // A name match never overrides a registry identity: if both rows carry one
  // and they differ, they stay separate. The curated record is considered
  // first, so it is the one that survives a collision and keeps its evidence,
  // aliases and relationships.
  const byKey = new Map();
  // name → the kept rows with that name, so a row with no known country can
  // still be recognised as the entity that knows its own.
  const byNameKey = new Map();
  const keptById = new Map();
  const kept = [];
  const merges = [];

  const register = (company, names) => {
    byKey.set(company.id, company.id);
    for (const name of names) {
      byKey.set(`${name}|${company.jurisdiction ?? ""}`, company.id);
      const bucket = byNameKey.get(name) ?? [];
      if (!bucket.includes(company.id)) bucket.push(company.id);
      byNameKey.set(name, bucket);
    }
  };
  const namesOf = (company) =>
    [company.name, ...company.aliases].map(matchKey).filter((name) => name !== "");

  for (const company of sorted) {
    const identity = registryIdentity(company);
    const names = namesOf(company);
    const keys = names.map((name) => `${name}|${company.jurisdiction ?? ""}`);
    const survivor =
      keptById.get(company.id) ??
      (identity ? kept.find((entry) => registryIdentity(entry) === identity) : null) ??
      kept.find((entry) => {
        if (identity && registryIdentity(entry) && registryIdentity(entry) !== identity) return false;
        if (keys.some((key) => byKey.get(key) === entry.id)) return true;
        // The same name in two KNOWN, different countries is two companies.
        // Anything else, including one side not knowing its country, is one.
        return (
          jurisdictionsCompatible(entry.jurisdiction, company.jurisdiction) &&
          names.some((name) => (byNameKey.get(name) ?? []).includes(entry.id))
        );
      });

    if (!survivor) {
      keptById.set(company.id, company);
      kept.push(company);
      register(company, names);
      if (identity) byKey.set(identity, company.id);
      continue;
    }

    merges.push({ kept: survivor.id, merged: company.id, name: company.name });
    for (const row of company.domains) {
      if (!survivor.domains.some((existing) => existing.domain === row.domain)) survivor.domains.push(row);
    }
    for (const alias of [company.name, ...company.aliases]) {
      if (!survivor.aliases.includes(alias) && matchKey(alias) !== matchKey(survivor.name)) survivor.aliases.push(alias);
      byKey.set(`${matchKey(alias)}|${survivor.jurisdiction ?? ''}`, survivor.id);
    }
    // The registry identity travels with the merged row, so the next duplicate
    // of the same entity is recognised by its number rather than by its name.
    survivor.source_id = survivor.source_id ?? company.source_id ?? null;
    survivor.jurisdiction = survivor.jurisdiction ?? company.jurisdiction ?? null;
    survivor.merged_ids = [...(survivor.merged_ids ?? []), company.id];
    survivor.aliases = survivor.aliases.slice().sort();
    // The survivor's name set grew and its jurisdiction may have been filled in
    // by the row just folded in, so both indexes are refreshed for it.
    register(survivor, namesOf(survivor));
  }
  return { companies: kept, merges };
}

/**
 * Two rows may be the same company when neither knows its country, or they
 * agree on it. Only two rows that both know their country and disagree are
 * kept apart - the rule in the comment above `mergeDuplicates`.
 */
export function jurisdictionsCompatible(a, b) {
  return a == null || b == null || a === b;
}

/** `source` + `source_id`, or null when the row carries no registry identity. */
export function registryIdentity(company) {
  if (!company?.source_id || !company?.source) return null;
  return `${company.source}:${company.source_id}`;
}

/** How many rows share a name within one jurisdiction: the ambiguity to review. */
export function duplicateNamesWithinJurisdiction(companies) {
  const seen = new Map();
  for (const company of companies) {
    const key = `${matchKey(company.name)}|${company.jurisdiction ?? ''}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const count of seen.values()) duplicates += count - 1;
  return duplicates;
}

/** Mirrors `public.company_slugify` in the migration history. */
export function slugify(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "company";
}

/* ---------------------------------------------------------------------------
 * Ownership and ranking
 * ------------------------------------------------------------------------ *//**
 * Claims are DATA. A domain may be claimed by several companies at different
 * strengths and none of them is deleted for disagreeing: an unverified row is
 * evidence, and one seed's mistake must not be able to erase a legitimate
 * entity's claim or freeze a domain forever. What is resolved here is not who
 * may hold a row - it is which claim is the CANONICAL OWNER (the steward) and
 * whether the domain is contested.
 *
 * Only verification stays unique, because a mailbox has to resolve to exactly
 * one company: `company_domains_verified_domain_idx` is untouched. Everything
 * under that line is opinion with provenance, and it is allowed to disagree.
 *
 * `verifiedClaims` is what the DATABASE already holds - a seed build has none,
 * a re-check against production passes them in - so the same resolver describes
 * both an import and the live table.
 */
export function resolveDomainClaims(companies, { verifiedClaims = [] } = {}) {
  const claims = new Map();
  for (const company of companies) {
    for (const row of company.domains) {
      if (!claims.has(row.domain)) claims.set(row.domain, []);
      claims.get(row.domain).push({ companyId: company.id, companyName: company.name, row });
    }
  }

  const verifiedByDomain = new Map(verifiedClaims.map((claim) => [claim.domain, claim.company_id]));
  const owners = new Map();
  const statuses = new Map();
  const conflicts = [];

  for (const [domain, entries] of [...claims.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const verifiedOwner = verifiedByDomain.get(domain) ?? null;
    const sorted = entries.slice().sort(compareClaims);
    const top = sorted[0];
    // A tie is equal STRENGTH, not equal ordering: compareClaims falls back to
    // the company id so the sort is total, and using it here would make the tie
    // depend on which company happens to sort first.
    const tied = sorted.filter(
      (entry) =>
        entry !== top &&
        TIER_ORDER[entry.row.confidence] === TIER_ORDER[top.row.confidence] &&
        entry.row.evidence_count === top.row.evidence_count
    );
    const contested = sorted.length > 1;

    let status;
    let steward;
    if (verifiedOwner) {
      // A proof outranks every opinion, including a stronger-looking claim.
      status = "verified";
      steward = verifiedOwner;
    } else if (tied.length > 0 && TIER_ORDER[top.row.confidence] >= TIER_ORDER.medium) {
      status = "contested";
      steward = null;
    } else {
      status = "resolved";
      steward = top.companyId;
    }

    const claimants = sorted.map((entry) => ({
      company_id: entry.companyId,
      company_name: entry.companyName,
      domain_type: entry.row.domain_type,
      confidence: entry.row.confidence,
      evidence_count: entry.row.evidence_count,
      // Derived, never stored: a claim on a domain somebody else has verified
      // is superseded, and it is reported rather than deleted.
      superseded: verifiedOwner !== null && entry.companyId !== verifiedOwner
    }));

    owners.set(domain, steward);
    statuses.set(domain, {
      domain,
      status,
      steward,
      contested,
      verified_owner: verifiedOwner,
      claimants
    });

    if (contested) {
      conflicts.push({
        domain,
        severity: status === "contested" ? "blocking" : "review",
        reason:
          status === "contested"
            ? "two claims at equal strength: no steward can be chosen"
            : "more than one claim; the strongest is the steward and the rest are kept as evidence",
        claimants
      });
    }
  }

  return { owners, statuses, conflicts, verifiedByDomain };
}

function compareClaims(a, b) {
  return (
    TIER_ORDER[b.row.confidence] - TIER_ORDER[a.row.confidence] ||
    b.row.evidence_count - a.row.evidence_count ||
    a.companyId.localeCompare(b.companyId)
  );
}

function stewardOf(companyId, companyById) {
  if (!companyId) return null;
  const company = companyById?.get?.(companyId);
  return { company_id: companyId, company_name: company?.name ?? null };
}

/**
 * The verification decision, as a function: the executable form of the
 * decision table in docs/company-directory-architecture.md. Every outcome is a
 * status the SQL functions and the route already speak (or will, in the next
 * PR), so the product rules are testable without a database and the database
 * rules have something to be compared against.
 *
 * The shape of the rule: a PROOF (a verified claim) decides; an unverified
 * claim is evidence and is weighed; a relationship between two companies never
 * transfers a domain, and a delegation transfers acceptability only when it is
 * explicit and reviewed.
 */
export function resolveVerification({
  domain,
  selectedCompanyId = null,
  claimsByDomain = null,
  delegations = [],
  companyById = null,
  newCompanyName = null,
  nameMatchesDomain = null
}) {
  const normalised = normalizeDomain(domain);
  if (!normalised) return { outcome: "invalid_domain", domain: null, claimants: [] };

  const claim = claimsByDomain?.get?.(normalised) ?? null;
  const verifiedOwner = claim?.verified_owner ?? null;
  const claimants = claim?.claimants ?? [];

  if (selectedCompanyId) {
    const mine = claimants.find((entry) => entry.company_id === selectedCompanyId) ?? null;

    if (verifiedOwner === selectedCompanyId || mine) {
      // A (verified), B (a hint of its own), D (contested, but this company is
      // one of the claimants: its own proof decides), E and F (its own domain).
      return {
        outcome: "verify_as_selected",
        domain: normalised,
        steward: stewardOf(selectedCompanyId, companyById),
        reason:
          verifiedOwner === selectedCompanyId
            ? "verified_by_selected"
            : claim?.status === "contested"
              ? "contested_claim"
              : mine.confidence === "unknown"
                ? "website_hint"
                : "claim_exists",
        claimants
      };
    }

    // E/F across entities. No claim of its own, so only an explicit, REVIEWED
    // delegation lets a member verify as this entity on another's domain - and
    // the steward stays recorded as the entity that owns it.
    const delegation = delegations.find(
      (entry) => entry.domain === normalised && entry.company_id === selectedCompanyId
    );
    if (delegation?.effective && (verifiedOwner || claim?.steward)) {
      return {
        outcome: "verify_via_delegation",
        domain: normalised,
        steward: stewardOf(verifiedOwner ?? claim.steward, companyById),
        reason: "delegated_by_steward",
        claimants
      };
    }

    if (verifiedOwner) {
      // C. A proof outranks the name the member picked; the route offers the
      // owning company instead, never the other way round.
      return {
        outcome: "join_other_company",
        domain: normalised,
        steward: stewardOf(verifiedOwner, companyById),
        reason: "verified_by_other_company",
        claimants
      };
    }

    return {
      outcome: "domain_unclaimed_by_selected",
      domain: normalised,
      steward: stewardOf(claim?.steward ?? null, companyById),
      reason: delegation ? "delegation_not_reviewed" : "not_a_company_domain",
      claimants
    };
  }

  // G/H: creating a company for a domain. A claim blocks the new entity only
  // when it is strong, or when it is the same company under another spelling.
  // A weak, unrelated claim does not: it is evidence the new entity supersedes
  // by proving the mailbox, which is what stops a bad seed from permanently
  // preventing a real company from being represented.
  if (verifiedOwner) {
    return {
      outcome: "join_other_company",
      domain: normalised,
      steward: stewardOf(verifiedOwner, companyById),
      reason: "verified_by_other_company",
      claimants
    };
  }

  const strong = claimants.filter((entry) => entry.confidence === "high" || entry.confidence === "medium");
  const sameName = newCompanyName
    ? claimants.filter((entry) => matchKey(entry.company_name) === matchKey(newCompanyName))
    : [];
  if (strong.length > 0 || sameName.length > 0) {
    const blocker = strong[0] ?? sameName[0];
    return {
      outcome: "join_other_company",
      domain: normalised,
      steward: stewardOf(blocker.company_id, companyById),
      reason: strong.length > 0 ? "claimed_at_medium_or_better" : "same_company_name",
      claimants
    };
  }

  if (nameMatchesDomain === false) {
    return { outcome: "name_does_not_match_domain", domain: normalised, claimants };
  }

  return {
    outcome: "create_company_for_domain",
    domain: normalised,
    claimants,
    // Recorded so the import can report that proving this domain supersedes
    // weak claims: the rows survive, and the resolver marks them superseded.
    supersedes: claimants.map((entry) => entry.company_id)
  };
}

/**
 * A deterministic rank, built only from fields that exist. If employee counts,
 * revenue or active status were available they would come first; until then the
 * rank leans on the quality of the DOMAIN EVIDENCE (a company whose mail domain
 * is evidence-backed is more useful in a picker than one that is only a name),
 * then on Wikidata sitelinks, which are a notability proxy and explicitly not a
 * size proxy. `rank_basis` records which of those decided the order, so nobody
 * has to guess whether 12,000 means "medium company" or "has a Wikipedia page".
 */
export function rankCompanies(companies) {
  const key = (company) => [
    company.email_domains.length > 0 ? 1 : 0,
    TIER_ORDER[company.best_confidence],
    company.email_evidence_score,
    Math.min(company.sitelinks, 1000)
  ];
  const ordered = companies.slice().sort((a, b) => {
    const left = key(a);
    const right = key(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return a.normalized_name.localeCompare(b.normalized_name) || a.id.localeCompare(b.id);
  });
  return ordered.map((company, index) => ({
    ...company,
    directory_rank: index + 1,
    rank_basis:
      company.email_domains.length > 0
        ? "email_evidence"
        : company.sitelinks > 0
          ? "wikidata_sitelinks"
          : "name_only"
  }));
}

/**
 * Sampling is what makes the staged prototype possible: the same pipeline runs
 * at 1,000 and at 500,000. Curated entities always survive - they are the ones
 * with relationships and evidence - and the rest is taken in rank order.
 */
export function sampleCompanies(companies, size) {
  if (!Number.isFinite(size) || size >= companies.length) return companies;
  const curated = companies.filter((company) => company.layer === "curated");
  const rest = companies.filter((company) => company.layer !== "curated");
  return [...curated, ...rest.slice(0, Math.max(size - curated.length, 0))];
}

/* ---------------------------------------------------------------------------
 * Output
 * ------------------------------------------------------------------------ */

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
  return [header.join(","), ...rows.map((row) => row.map(csvValue).join(","))].join("\n") + "\n";
}

/**
 * The entity file, and only the entity: exactly the columns the importer reads.
 *
 * `normalized_name` is derived from `company_name` and nothing reads it;
 * `website_domain` and `employee_email_domains` are a second, lossy copy of
 * rows that `company_domains.csv` states canonically (with their type,
 * confidence and source); `parent_company_id` is one column trying to hold a
 * graph that `company_relationships.csv` holds properly; and `aliases` is a
 * `;`-joined string standing in for the alias table. Every one of those was
 * ignored by the importer, which is exactly the failure mode of a duplicated
 * field: it looks authoritative and nothing checks it. They are gone.
 *
 * What remains is identity (`company_id`), the searchable name, the registry's
 * own number and jurisdiction - what makes two rows the same entity and lets a
 * later import recognise a renamed company - and the rank the picker sorts by.
 */
export function companiesCsv(companies) {
  const header = [
    "company_id",
    "company_name",
    "country",
    "industry",
    "source",
    "source_id",
    "jurisdiction",
    "source_confidence",
    "directory_rank"
  ];
  const rows = companies.map((company) => [
    company.id,
    company.name,
    company.country,
    company.industry,
    company.source,
    company.source_id ?? "",
    company.jurisdiction ?? "",
    company.source_confidence,
    company.directory_rank
  ]);
  return toCsv(header, rows);
}

/**
 * The claim rows. `claim_status` and `steward_company_id` are the resolver's
 * output, not stored fields: a domain's status is a function of all the claims
 * on it, so storing it per row would be a second copy that can drift. The same
 * is true of `evidence_confidence`, which IS stored, because policy reads it
 * without wanting to re-derive it from the evidence table.
 */
export function companyDomainsCsv(companies, owners, statuses = new Map()) {
  const header = [
    "company_id",
    "domain",
    "domain_type",
    "verified",
    "source",
    "source_url",
    "evidence_confidence",
    "evidence_count",
    "evidence_types",
    "claim_status",
    "steward_company_id",
    "first_seen_at",
    "last_verified_at"
  ];
  const rows = [];
  for (const company of companies) {
    for (const row of company.domains.slice().sort((a, b) => a.domain.localeCompare(b.domain))) {
      const status = statuses.get(row.domain);
      rows.push([
        company.id,
        row.domain,
        row.domain_type,
        row.verified,
        row.source,
        row.source_url,
        row.confidence,
        row.evidence_count ?? 0,
        row.evidence_kinds.join(";"),
        status ? (status.verified_owner && status.verified_owner !== company.id ? "superseded" : status.status) : "none",
        owners.get(row.domain) ?? "",
        row.first_seen_at ?? "",
        row.verified ? row.last_verified_at ?? "" : ""
      ]);
    }
  }
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])));
  return toCsv(header, rows);
}

/**
 * One row per observation. This is the table that makes a claim auditable and
 * re-checkable, and the reason `company_domains` does not need a count or a
 * list of sources: the observations are here, with their URLs.
 *
 * `observed_at` is deliberately empty in generated output: a timestamp written
 * by the generator would make the output non-deterministic, and the only honest
 * time is when a human or a job actually looked.
 */
export function domainEvidenceCsv(companies) {
  const header = ["company_id", "domain", "evidence_type", "source_url", "source", "checked", "observed_at"];
  const rows = [];
  for (const company of companies) {
    for (const row of company.domains) {
      for (const observation of row.evidence ?? []) {
        rows.push([
          observation.company_id ?? company.id,
          observation.domain ?? row.domain,
          observation.evidence_type,
          observation.source_url,
          observation.source ?? row.source ?? "",
          observation.checked,
          observation.observed_at ?? ""
        ]);
      }
    }
  }
  rows.sort(
    (a, b) =>
      String(a[1]).localeCompare(String(b[1])) ||
      String(a[0]).localeCompare(String(b[0])) ||
      String(a[2]).localeCompare(String(b[2]))
  );
  return toCsv(header, rows);
}

/**
 * The alias feed: `company_id, alias, alias_type, source`.
 *
 * `aliases` are identity AND search names; `former_names` are search-only, so
 * the type travels with the row and a former legal name can never collapse a
 * brand and its parent into one entity. The canonical name is NOT repeated here
 * - `companies.company_name` is already a search name - so this file holds only
 * the OTHER names a company is known by.
 *
 * Validation happens here rather than in the importer's rejection report: an
 * empty alias, one longer than the importer accepts, or a name on a company
 * this export does not contain is a bug in the curated layer, and a bug should
 * stop the build rather than arrive later as a rejected row.
 */
export function companyAliasRows(companies) {
  const seen = new Set();
  const rows = [];
  for (const company of companies) {
    for (const [alias_type, names] of [
      ["alias", company.aliases ?? []],
      ["former_name", company.former_names ?? []]
    ]) {
      for (const name of names) {
        const alias = String(name ?? "").trim();
        if (alias === "") continue;
        if (alias.length > 120) {
          throw new Error(`alias longer than 120 characters: ${company.id} / ${alias}`);
        }
        // A name stated twice is one alias. The importer keys on the lowercased
        // (company, alias) pair, so a second copy of the same string would come
        // back as `duplicate_alias_in_export` - a self-inflicted rejection.
        const key = `${company.id}\u0000${alias.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          company_id: company.id,
          alias,
          alias_type,
          source: company.source ?? CURATED_SOURCE
        });
      }
    }
  }
  return rows.sort(compareAliasRows);
}

function compareAliasRows(a, b) {
  return (
    a.company_id.localeCompare(b.company_id) ||
    a.alias.localeCompare(b.alias) ||
    a.alias_type.localeCompare(b.alias_type)
  );
}

/**
 * The relationship feed: `parent_company_id, child_company_id,
 * relationship_type, source`.
 *
 * A curated edge is authored as `{ from, child, type }` and is written through
 * UNCHANGED: `from` is the subject of the statement and `child` its object, and
 * the type says how the object stands to the subject. "meta-platforms /
 * facebook / brand" reads "Facebook is Meta's brand"; "facebook /
 * meta-platforms / parent" reads "Meta is Facebook's parent". Both directions a
 * curated entity states are kept, because both are authored facts and the
 * database's unique key is the whole (parent, child, type) triple - normalising
 * the inverse rows away would be the generator second-guessing the layer.
 *
 * Three things are refused outright, because each is a bug in the curated layer
 * rather than data for the operator's review queue:
 *   * an endpoint this export does not contain (a dangling edge would state who
 *     owns whom about a company nobody described);
 *   * a self-edge (the database's `company_relationships_not_self` check);
 *   * a type outside the database's vocabulary (`relationship_type` check).
 * A repeated triple is collapsed instead, and silently: the same edge stated
 * twice is one row.
 */
export function companyRelationshipRows(relationships, companies) {
  const ids = companies instanceof Set ? companies : new Set(companies.map((company) => company.id));
  const seen = new Set();
  const rows = [];
  for (const edge of relationships) {
    const parent_company_id = edge.from;
    const child_company_id = edge.child;
    const relationship_type = edge.type;
    if (!ids.has(parent_company_id) || !ids.has(child_company_id)) {
      throw new Error(
        `relationship references a company outside the export: ${parent_company_id} -> ${child_company_id}`
      );
    }
    if (parent_company_id === child_company_id) {
      throw new Error(`self relationship: ${parent_company_id}`);
    }
    if (!RELATIONSHIP_TYPES.includes(relationship_type)) {
      throw new Error(
        `unknown relationship_type ${relationship_type}: ${parent_company_id} -> ${child_company_id}`
      );
    }
    const key = `${parent_company_id}\u0000${child_company_id}\u0000${relationship_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ parent_company_id, child_company_id, relationship_type, source: CURATED_SOURCE });
  }
  return rows.sort(
    (a, b) =>
      a.parent_company_id.localeCompare(b.parent_company_id) ||
      a.child_company_id.localeCompare(b.child_company_id) ||
      a.relationship_type.localeCompare(b.relationship_type)
  );
}

export function companyAliasesCsv(rows) {
  const header = ["company_id", "alias", "alias_type", "source"];
  return toCsv(
    header,
    rows.map((row) => [row.company_id, row.alias, row.alias_type, row.source])
  );
}

export function companyRelationshipsCsv(rows) {
  const header = ["parent_company_id", "child_company_id", "relationship_type", "source"];
  return toCsv(
    header,
    rows.map((row) => [row.parent_company_id, row.child_company_id, row.relationship_type, row.source])
  );
}

/**
 * The nine metrics the staged plan asks for at every scale (1k → 10k → 50k →
 * 100k), computed from whatever the layers actually contain. This is what makes
 * a coverage claim measurable instead of extrapolated: run it, paste the
 * numbers, and only then project.
 */
export function stagedMetrics({ companies, conflicts, merges, owners }) {
  const domains = companies.flatMap((company) => company.domains);
  const emailRows = domains.filter((row) => EMAIL_BEARING_TYPES.has(row.domain_type));
  const tier = (name) => emailRows.filter((row) => row.confidence === name).length;
  const unresolved = companies.filter((company) => !company.email_domains.some((domain) => owners.get(domain) === company.id));
  return [
    { metric: "companies", value: companies.length },
    { metric: "unique domains", value: new Set(domains.map((row) => row.domain)).size },
    { metric: "website-only domains", value: domains.length - emailRows.length },
    { metric: "high-confidence email domains", value: tier("high") },
    { metric: "medium-confidence email domains", value: tier("medium") },
    { metric: "low-confidence email domains", value: tier("low") },
    { metric: "domains with conflicting evidence", value: conflicts.length },
    { metric: "unresolved companies (no email domain of their own)", value: unresolved.length },
    { metric: "duplicate entities merged", value: merges.length }
  ];
}

/**
 * Coverage, per the rule that nothing may be dropped silently: every rejected
 * domain and every conflict appears here with its reason.
 */
export function coverageReport({
  companies,
  owners,
  statuses = new Map(),
  conflicts,
  delegations = [],
  sources,
  layerStats,
  rejected,
  sampleSize,
  relationships = [],
  aliases = [],
  merges = [],
  excludedFixtures = [],
  inputRows = 0
}) {
  const withWebsite = companies.filter((company) => company.website_domain).length;
  const withEmail = companies.filter((company) => company.email_domains.length > 0).length;
  const multiEmail = companies.filter((company) => company.email_domains.length > 1).length;
  const domains = companies.flatMap((company) => company.domains);
  const evidenceCount = domains.flatMap((row) => row.evidence ?? []).length;
  const byConfidence = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const row of domains) byConfidence[row.confidence] = (byConfidence[row.confidence] ?? 0) + 1;
  const emailDomains = domains.filter((row) => EMAIL_BEARING_TYPES.has(row.domain_type));
  const emailByConfidence = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const row of emailDomains) emailByConfidence[row.confidence] = (emailByConfidence[row.confidence] ?? 0) + 1;

  // Name collisions WITHIN a jurisdiction: the same name in two countries is
  // two companies, not a duplicate, so counting bare names would overstate it.
  const duplicateNames = duplicateNamesWithinJurisdiction(companies);
  const withRegistryIdentity = companies.filter((company) => registryIdentity(company)).length;
  const reasonCounts = new Map();
  for (const entry of rejected) {
    for (const reason of entry.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const lines = [];
  lines.push("# Company directory coverage report");
  lines.push("");
  lines.push("Generated by `scripts/generate-company-directory-v2.mjs`. Every count below is");
  lines.push("derived from the layer files in `data/company-directory/`, which are the input of");
  lines.push("record; the report is a view of them and is regenerated rather than edited.");
  lines.push("");
  lines.push(`Sample size requested: ${sampleSize === null ? "all rows" : sampleSize.toLocaleString("en-US")}`);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Input rows read from the layers | ${inputRows.toLocaleString("en-US")} |`);
  lines.push(`| Companies after merging duplicates | ${companies.length.toLocaleString("en-US")} |`);
  lines.push(`| Unique companies (by id) | ${new Set(companies.map((c) => c.id)).size.toLocaleString("en-US")} |`);
  lines.push(`| Companies with a website domain | ${withWebsite.toLocaleString("en-US")} |`);
  lines.push(`| Companies with at least one email domain | ${withEmail.toLocaleString("en-US")} |`);
  lines.push(`| Companies with more than one email domain | ${multiEmail.toLocaleString("en-US")} |`);
  lines.push(`| Company-domain rows | ${domains.length.toLocaleString("en-US")} |`);
  lines.push(`| Unique domains | ${new Set(domains.map((row) => row.domain)).size.toLocaleString("en-US")} |`);
  lines.push(`| Parent/subsidiary/brand relationships | ${relationships.length.toLocaleString("en-US")} |`);
  lines.push(`| Aliases and former names (excluding the canonical name) | ${aliases.length.toLocaleString("en-US")} |`);
  lines.push(`| Duplicate entities merged into one | ${merges.length.toLocaleString("en-US")} |`);
  lines.push(`| Same name within one jurisdiction after merging (to review) | ${duplicateNames.toLocaleString("en-US")} |`);
  lines.push(`| Rows carrying a registry identity (source + source_id) | ${withRegistryIdentity.toLocaleString("en-US")} |`);
  if (excludedFixtures.length > 0) {
    lines.push("");
    lines.push(
      `Fixtures excluded from the export (counter-examples, never production data): ` +
        excludedFixtures.map((id) => `\`${id}\``).join(", ")
    );
  }
  if (merges.length > 0) {
    lines.push("");
    lines.push("Merged (the survivor keeps its evidence, the merged row's domains survive as hints):");
    lines.push("");
    for (const merge of merges.slice(0, 10)) {
      lines.push(`- \`${merge.merged}\` (${merge.name}) → \`${merge.kept}\``);
    }
  }
  lines.push("");
  lines.push("## The export files (one canonical place per fact)");
  lines.push("");
  lines.push("Read by `scripts/import-company-directory.mjs` by header name. A fact appears");
  lines.push("in exactly one file, so no column can drift out of agreement with the file the");
  lines.push("importer actually reads.");
  lines.push("");
  lines.push("| File | Holds | Rows |");
  lines.push("| --- | --- | --- |");
  lines.push(`| \`companies.csv\` | the entity: id, name, country, industry, registry identity, rank | ${companies.length.toLocaleString("en-US")} |`);
  lines.push(`| \`company_domains.csv\` | every domain claim - official website and employee email alike, told apart by \`domain_type\` | ${domains.length.toLocaleString("en-US")} |`);
  lines.push(`| \`domain_evidence.csv\` | the observations behind a claim | ${evidenceCount.toLocaleString("en-US")} |`);
  lines.push(`| \`company_aliases.csv\` | alias / former_name search names, typed | ${aliases.length.toLocaleString("en-US")} |`);
  lines.push(`| \`company_relationships.csv\` | parent / subsidiary / brand / division structure | ${relationships.length.toLocaleString("en-US")} |`);
  lines.push("");
  lines.push("## Confidence of email-bearing domains");
  lines.push("");
  lines.push("| Tier | Domains | Companies relying on it |");
  lines.push("| --- | --- | --- |");
  for (const tier of ["high", "medium", "low"]) {
    const count = companies.filter((company) => company.best_confidence === tier && company.email_domains.length > 0).length;
    lines.push(`| ${tier} | ${emailByConfidence[tier]} | ${count} |`);
  }
  lines.push(`| no email evidence (website only) | ${byConfidence.unknown} | ${companies.length - withEmail} |`);
  lines.push("");
  lines.push("## Layers");
  lines.push("");
  lines.push("| Layer | Companies | Source | Status in the registry |");
  lines.push("| --- | --- | --- | --- |");
  for (const [layer, count] of Object.entries(layerStats)) {
    const sourceId = layer === "seed" ? "wikidata" : layer;
    const source = sources.get(sourceId) ?? sources.get(layer);
    lines.push(
      `| ${layer} | ${count.toLocaleString("en-US")} | ${source?.name ?? "hand-curated in this repository"} | ${source?.status ?? "not a licensed source"} |`
    );
  }
  lines.push("");
  lines.push("## Rejected domains (nothing is dropped silently)");
  lines.push("");
  if (rejected.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Reason | Domains |");
    lines.push("| --- | --- |");
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${reason}\` | ${count} |`);
    }
    lines.push("");
    lines.push("Examples:");
    lines.push("");
    for (const entry of rejected.slice(0, 12)) {
      lines.push(`- \`${entry.domain}\` (${entry.company}) - ${entry.reasons.join(", ")}`);
    }
  }
  lines.push("");
  lines.push("## Domain claims");
  lines.push("");
  const claimStatuses = { verified: 0, resolved: 0, contested: 0 };
  for (const status of statuses.values()) claimStatuses[status.status] = (claimStatuses[status.status] ?? 0) + 1;
  lines.push("Claims are allowed to disagree: several companies may hold a row on one domain,");
  lines.push("and the resolver names a steward where the evidence supports one.");
  lines.push("");
  lines.push("| Resolution | Domains |");
  lines.push("| --- | --- |");
  lines.push(`| verified by a member (passed in from the live table) | ${claimStatuses.verified} |`);
  lines.push(`| resolved to a single steward | ${claimStatuses.resolved} |`);
  lines.push(`| contested: equal strength, no steward chosen | ${claimStatuses.contested} |`);
  lines.push("");
  lines.push("## Conflicts (kept as data, never resolved by deleting a row)");
  lines.push("");
  if (conflicts.length === 0) {
    lines.push("None: no domain is claimed by more than one company.");
  } else {
    lines.push("| Domain | Severity | Steward | Claimants |");
    lines.push("| --- | --- | --- | --- |");
    for (const conflict of conflicts.slice(0, 25)) {
      const steward = owners.get(conflict.domain);
      lines.push(
        `| \`${conflict.domain}\` | ${conflict.severity} | ${steward ?? "none chosen"} | ${conflict.claimants
          .map((claimant) => `${claimant.company_name} (${claimant.confidence}${claimant.superseded ? ", superseded" : ""})`)
          .join(", ")} |`
      );
    }
    const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
    if (blocking.length > 0) {
      lines.push("");
      lines.push(`**${blocking.length} blocking** (no steward could be chosen; those domains have no owner).`);
    }
  }
  lines.push("");
  lines.push("## Evidence on file");
  lines.push("");
  const evidenceCounts = new Map();
  for (const company of companies) {
    for (const row of company.domains) {
      for (const observation of row.evidence ?? []) {
        evidenceCounts.set(observation.evidence_type, (evidenceCounts.get(observation.evidence_type) ?? 0) + 1);
      }
    }
  }
  if (evidenceCounts.size === 0) {
    lines.push("No evidence rows at all: every domain here is a website hint.");
  } else {
    lines.push("| Evidence kind | Observations |");
    lines.push("| --- | --- |");
    for (const [kind, count] of [...evidenceCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${kind}\` | ${count} |`);
    }
  }
  lines.push("");
  lines.push("## Mail delegations");
  lines.push("");
  if (delegations.length === 0) {
    lines.push("None: no entity is allowed to verify on another entity's domain.");
  } else {
    lines.push("| Company | Domain | Granted by | Effective |");
    lines.push("| --- | --- | --- | --- |");
    for (const delegation of delegations) {
      lines.push(`| \`${delegation.company_id}\` | \`${delegation.domain}\` | ${delegation.granted_by} | ${delegation.effective} |`);
    }
  }
  lines.push("");
  lines.push("## Staged measurement");
  lines.push("");
  lines.push("The nine metrics the staged plan reports at every scale. Paste these numbers");
  lines.push("instead of projecting: only a measured stage is a coverage claim.");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  for (const entry of stagedMetrics({ companies, conflicts, merges, owners })) {
    lines.push(`| ${entry.metric} | ${entry.value.toLocaleString("en-US")} |`);
  }
  lines.push("");
  lines.push("## Source registry");
  lines.push("");
  lines.push("| Source | Status | Redistribution | Derived data in the repo | Licence |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const source of sources.values()) {
    lines.push(
      `| ${source.name} | ${source.status} | ${source.redistribution_allowed ?? "n/a"} | ${source.derived_data_committable ?? "n/a"} | ${source.license.split(";")[0]} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

/* ---------------------------------------------------------------------------
 * docs/company-data-sources.md, rendered from the registry
 * ------------------------------------------------------------------------ */

/**
 * Every source decision lives in data/company-directory/sources.json, so the
 * document that explains them is rendered from it rather than written twice. A
 * hand-maintained copy drifts the first time a licence is re-checked.
 */
export function sourcesMarkdown(registry, licensing = { sources: {} }) {
  const real = registry.sources.filter((source) => !["curated", "example"].includes(source.id));
  const licence = (source) => licensing.sources?.[source.id] ?? {};
  const adopted = real.filter((source) => source.status === "adopted");
  const candidates = real.filter((source) => source.status === "candidate");
  const rejected = real.filter((source) => source.status === "rejected");
  // One licence block per source, so the per-source sections below carry the
  // same terms as the matrix rather than a second copy of them.
  const lines = [];

  lines.push("# Company data sources");
  lines.push("");
  lines.push("Which datasets the company directory may be built from, under what licence,");
  lines.push("and what each one is and is not good for. **Generated from");
  lines.push("`data/company-directory/sources.json`** by");
  lines.push("`node scripts/generate-company-directory-v2.mjs --write-docs` — edit the registry,");
  lines.push("not this file.");
  lines.push("");
  lines.push(`Registry reviewed: ${registry.generated_at}. A licence line here is a record of what`);
  lines.push("the source states, not legal advice, and every one of them should be re-checked");
  lines.push("against the live terms before a tier is shipped.");
  lines.push("");
  lines.push("| Source | Status | Domain data | Redistribution | Committable here |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const source of real) {
    const terms = licence(source);
    lines.push(
      `| [${source.name}](${source.url}) | ${source.status} | ${source.domain_fields.split(".")[0]}. | ${terms.redistribution ?? "see registry"} | ${terms.committable ?? "see registry"} |`
    );
  }
  lines.push("");
  lines.push(`${adopted.length} adopted, ${candidates.length} candidates, ${rejected.length} rejected.`);
  lines.push("");
  lines.push("## Licensing matrix (the question that blocks a public repository)");
  lines.push("");
  lines.push("A source can be perfectly usable and still not committable: a share-alike licence on a");
  lines.push("derived database, or a subscription that forbids redistribution, is what decides whether");
  lines.push("rows built from it may live in this repository. Rendered from");
  lines.push("`data/company-directory/licensing.json`.");
  lines.push("");
  lines.push("| Source | Redistribution | Derived data committable | Attribution required | API restrictions | Rate limits |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const source of real) {
    const terms = licence(source);
    lines.push(
      `| ${source.name} | ${terms.redistribution ?? "-"} | **${terms.committable ?? "-"}** | ${terms.attribution ?? "-"} | ${terms.api_restrictions ?? "-"} | ${terms.rate_limits ?? "-"} |`
    );
  }
  lines.push("");
  for (const entry of licensing.rejected_for_licence ?? []) {
    lines.push(`- **${entry.name}** - ${entry.why}`);
    lines.push("");
  }
  const conditional = real.filter((source) => (licence(source).committable ?? "").startsWith("only") || (licence(source).committable ?? "").includes("check"));
  if (conditional.length > 0) {
    lines.push("Sources whose commit decision is conditional (re-read the live terms before a tier ships):");
    lines.push("");
    for (const source of conditional) lines.push(`- ${source.name}: ${licence(source).committable}`);
    lines.push("");
  }
  lines.push("## How a source is added");
  lines.push("");
  lines.push("1. Add an entry to `data/company-directory/sources.json` with the licence, the");
  lines.push("   coverage, the domain availability and the limitations above.");
  lines.push("2. Prove it on one tier (1,000 companies) before it touches a larger one, and");
  lines.push("   keep the licence decision visible in the diff.");
  lines.push("3. Regenerate this document and the coverage report together, so the licence and");
  lines.push("   the rows that came from it land in the same review.");
  lines.push("");
  lines.push("A source that is `candidate` is not read by the pipeline: the generator refuses a");
  lines.push("layer whose source is not `adopted`, so adding one is a deliberate two-step.");
  lines.push("");

  for (const group of [
    { title: "Adopted", entries: adopted },
    { title: "Candidates (evaluated, not yet wired up)", entries: candidates },
    { title: "Rejected (with the reason)", entries: rejected }
  ]) {
    if (group.entries.length === 0) continue;
    lines.push(`## ${group.title}`);
    lines.push("");
    for (const source of group.entries) {
      lines.push(`### ${source.name}`);
      lines.push("");
      lines.push(`- **Licence:** ${source.license}`);
      if (source.license_url) lines.push(`- **Terms:** ${source.license_url}`);
      lines.push(`- **Commercial use:** ${source.commercial_use}`);
      lines.push(`- **Attribution required:** ${source.attribution_required ? "yes" : "no"}`);
      lines.push(`- **Coverage:** ${source.coverage}`);
      lines.push(`- **Country coverage:** ${source.country_coverage}`);
      lines.push(`- **Company types:** ${source.company_types}`);
      lines.push(`- **Domain availability:** ${source.domain_fields}`);
      lines.push(`- **Update frequency:** ${source.update_frequency}`);
      lines.push(`- **Access:** ${source.access_method}`);
      lines.push(`- **Layer:** ${source.layer}`);
      const terms = licence(source);
      lines.push(`- **Redistribution:** ${terms.redistribution ?? "see registry"}`);
      lines.push(`- **Derived data committable to this repository:** ${terms.committable ?? "see registry"}`);
      lines.push(`- **Attribution:** ${terms.attribution ?? "see registry"}`);
      lines.push(`- **API restrictions:** ${terms.api_restrictions ?? "see registry"}`);
      lines.push(`- **Rate limits:** ${terms.rate_limits ?? "see registry"}`);
      lines.push("- **Limitations:**");
      for (const limitation of source.limitations) lines.push(`  - ${limitation}`);
      lines.push("");
      lines.push(source.notes);
      lines.push("");
    }
  }

  lines.push("## Not in the registry, by design");
  lines.push("");
  lines.push("`data/company-directory/curated.json` is not a dataset: it is hand-checked");
  lines.push("assertions with a per-row evidence URL, and the pipeline requires every cited");
  lines.push("source to exist in the registry. Anything without a licence and a provenance URL");
  lines.push("does not get a layer.");
  lines.push("");
  return lines.join("\n");
}

/* ---------------------------------------------------------------------------
 * The proposed migration (a draft, never written into supabase/migrations)
 * ------------------------------------------------------------------------ */

export function proposedSql(companies, owners) {
  const escape = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const rows = [];
  rows.push("-- ============================================================");
  rows.push("-- DRAFT - NOT APPLIED, NOT A MIGRATION");
  rows.push("--");
  rows.push("-- The schema this file needs does not exist yet: it adds domain_type,");
  rows.push("-- source, source_url, source_confidence and evidence_count to");
  rows.push("-- company_domains, plus company_aliases and company_relationships.");
  rows.push("-- See docs/company-directory-architecture.md for the schema proposal and");
  rows.push("-- the review it needs before any of this is applied.");
  rows.push("--");
  rows.push("-- Regenerate with: node scripts/generate-company-directory-v2.mjs --sql");
  rows.push("-- ============================================================");
  rows.push("");
  // One DO block, for the same reason the v1 seed is one: the statements share
  // a session, so the staging table is visible to the statement that reads it,
  // and a failure rolls the whole seed back rather than half-applying it. The
  // staging table keys on the slug because ids are generated, and the slug is
  // what the two statements can both see.
  rows.push("do $directory_v2$");
  rows.push("begin");
  rows.push("");
  rows.push("create temporary table _company_directory_v2 (");
  rows.push("  slug                text not null,");
  rows.push("  domain              text not null,");
  rows.push("  domain_type         text not null,");
  rows.push("  source              text not null,");
  rows.push("  evidence_confidence text not null");
  rows.push(");");
  rows.push("");
  rows.push("create temporary table _company_evidence_v2 (");
  rows.push("  slug          text not null,");
  rows.push("  domain        text not null,");
  rows.push("  evidence_type text not null,");
  rows.push("  source_url    text,");
  rows.push("  checked       boolean not null");
  rows.push(");");
  rows.push("");
  const stagedRows = [];
  const evidenceRows = [];
  for (const company of companies) {
    for (const row of company.domains) {
      stagedRows.push(
        `  (${escape(company.id)}, ${escape(row.domain)}, ${escape(row.domain_type)}, ${escape(row.source)}, ${escape(row.confidence)})`
      );
      for (const observation of row.evidence ?? []) {
        evidenceRows.push(
          `  (${escape(company.id)}, ${escape(row.domain)}, ${escape(observation.evidence_type)}, ${observation.source_url ? escape(observation.source_url) : "null"}, ${Boolean(observation.checked)})`
        );
      }
    }
  }
  rows.push("insert into _company_directory_v2 values");
  rows.push(stagedRows.join(",\n") + ";");
  rows.push("");
  if (evidenceRows.length > 0) {
    rows.push("insert into _company_evidence_v2 values");
    rows.push(evidenceRows.join(",\n") + ";");
    rows.push("");
  }
  rows.push("insert into public.companies (name, slug) values");
  rows.push(
    companies
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((company) => `  (${escape(company.name)}, ${escape(company.id)})`)
      .join(",\n") + "\n" + "on conflict (slug) do nothing;"
  );
  rows.push("");
  rows.push("-- Hints only, and only where the domain is nobody's row yet: this file can");
  rows.push("-- never take a domain away from whoever holds it.");
  rows.push("insert into public.company_domains");
  rows.push("  (company_id, domain, domain_type, evidence_confidence, source)");
  rows.push("select c.id, d.domain, d.domain_type, d.evidence_confidence, d.source");
  rows.push("from _company_directory_v2 as d");
  rows.push("join public.companies as c on c.slug = d.slug");
  rows.push("where not exists (select 1 from public.company_domains as e where e.domain = d.domain)");
  rows.push("on conflict (company_id, domain) do nothing;");
  rows.push("");
  if (evidenceRows.length > 0) {
    rows.push("-- The observations behind the claims. Deleting and re-inserting one domain's");
    rows.push("-- evidence is how a re-check refreshes it, so the key is the observation.");
    rows.push("insert into public.domain_evidence (company_id, domain, evidence_type, source_url, checked)");
    rows.push("select c.id, e.domain, e.evidence_type, e.source_url, e.checked");
    rows.push("from _company_evidence_v2 as e");
    rows.push("join public.companies as c on c.slug = e.slug");
    rows.push("on conflict (company_id, domain, evidence_type, source_url) do nothing;");
    rows.push("");
  }
  rows.push("drop table if exists _company_directory_v2, _company_evidence_v2;");
  rows.push("");
  rows.push("end");
  rows.push("$directory_v2$;");
  rows.push("");
  return rows.join("\n");
}

/* ---------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------ */

function flagValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

export function buildDirectory({ sample = null } = {}) {
  const sources = loadSources();
  const freeEmail = freeEmailDomains();
  const rejected = [];
  const layerStats = {};
  const byId = new Map();

  // Fixtures are removed here, before anything is merged, so nothing derived
  // from one - a domain, a claim, an alias, an edge - can reach a feed. They are
  // counted rather than silently dropped, and the report names them.
  const curatedRecords = loadCurated();
  const excludedFixtures = curatedRecords
    .filter((record) => !isProductionRecord(record))
    .map((record) => record.id);

  const layers = [
    { layer: "curated", records: curatedRecords.filter(isProductionRecord) },
    ...loadSeeds().map((seed) => ({ layer: "seed", records: seed.entities ?? seed.companies ?? [] }))
  ];

  for (const { layer, records } of layers) {
    layerStats[layer] = (layerStats[layer] ?? 0) + records.length;
    for (const record of records) {
      const { company } = toCompany(record, { layer, freeEmail, sources });
      for (const problem of company.problems) {
        rejected.push({ domain: problem.domain, company: company.name, reasons: problem.reasons });
      }
      // Nothing is overwritten here: same-id and same-name records are both
      // handled by the merge step below, which reports what it collapsed.
      if (!byId.has(company.id)) byId.set(company.id, []);
      byId.get(company.id).push(company);
    }
  }

  // Two spellings of one employer are one row before anything else happens: a
  // duplicate company would otherwise claim the same domain twice and both
  // copies would end up in a picker.
  const inputRows = [...byId.values()].flat();
  const { companies: merged, merges } = mergeDuplicates(inputRows);
  // The sample is taken before resolution, so a 1,000-company build reports the
  // claims of its 1,000 companies rather than the whole layer's: resolution is
  // a property of the set being resolved.
  let companies = sample !== null ? sampleCompanies(rankCompanies(merged), sample) : merged;

  // A seed build has no verified claims: everything a layer produces is a hint.
  // The live-table path passes the verified rows in instead.
  const { owners, statuses, conflicts } = resolveDomainClaims(companies);
  // A claim that lost the resolution is not a route: only the steward's own
  // domains may be advertised as its mail.
  companies = companies.map((company) => {
    const emailDomains = company.email_domains.filter((domain) => owners.get(domain) === company.id);
    const best = company.domains
      .filter((row) => owners.get(row.domain) === company.id && EMAIL_BEARING_TYPES.has(row.domain_type))
      .reduce((top, row) => (TIER_ORDER[row.confidence] > TIER_ORDER[top] ? row.confidence : top), "unknown");
    return { ...company, email_domains: emailDomains, best_confidence: best };
  });

  companies = rankCompanies(companies);

  const parentById = new Map();
  for (const { layer, records } of layers) {
    if (layer !== "curated") continue;
    for (const record of records) {
      for (const relationship of record.relationships ?? []) {
        if (relationship.type === "parent") parentById.set(record.id, relationship.child);
      }
    }
  }
  const relationships = layers
    .filter(({ layer }) => layer === "curated")
    .flatMap(({ records }) => records.flatMap((record) => (record.relationships ?? []).map((relationship) => ({ from: record.id, ...relationship }))));
  companies = companies.map((company) => ({ ...company, parent_company_id: parentById.get(company.id) ?? null }));

  const delegations = loadDelegations();
  const companyById = new Map(companies.map((company) => [company.id, company]));
  return {
    companies,
    companyById,
    owners,
    statuses,
    conflicts,
    delegations,
    rejected,
    layerStats,
    sources,
    relationships,
    merges,
    excludedFixtures,
    inputRows: inputRows.length,
    freeEmail
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const sample = process.argv.includes("--sample") ? flagValue("--sample", null) : null;

  if (args.has("--write-docs")) {
    const registry = readJson(join(DATA_DIR, "sources.json"));
    const licensing = existsSync(join(DATA_DIR, "licensing.json")) ? readJson(join(DATA_DIR, "licensing.json")) : { sources: {} };
    writeFileSync(join(ROOT, "docs/company-data-sources.md"), sourcesMarkdown(registry, licensing));
    console.log("Wrote docs/company-data-sources.md from the source registry");
    return;
  }

  const result = buildDirectory({ sample });
  const { companies, owners, statuses, conflicts, delegations, rejected, layerStats, sources, relationships, merges, excludedFixtures } = result;

  // The invariant the fixture filter exists to keep, checked on the rows about
  // to be reported or written rather than only where they were loaded: a
  // production candidate never contains a fixture, whatever layer introduced it.
  const leakedFixtures = companies.filter((company) => FIXTURE_SOURCES.has(company.source));
  if (leakedFixtures.length > 0) {
    throw new Error(`fixture companies reached the export: ${leakedFixtures.map((company) => company.id).join(", ")}`);
  }

  // Built and validated once, before anything is written: the alias and
  // relationship feeds are the two that used to be dropped, and a layer bug in
  // either must fail the build (or `--check`) rather than surface as a silently
  // empty file. The coverage report and the CSV files read the same rows, so
  // they can never disagree about what was emitted.
  const aliasRows = companyAliasRows(companies);
  const relationshipRows = companyRelationshipRows(relationships, companies);

  const report = coverageReport({
    companies,
    owners,
    statuses,
    conflicts,
    delegations,
    sources,
    layerStats,
    rejected,
    sampleSize: sample,
    relationships,
    aliases: aliasRows,
    merges,
    excludedFixtures,
    inputRows: result.inputRows
  });

  if (args.has("--measure")) {
    // Just the staged metrics, as a markdown table, so a stage run can be
    // pasted into the staged plan without copying a whole report.
    console.log("| Metric | Value |");
    console.log("| --- | --- |");
    for (const entry of stagedMetrics({ companies, conflicts, merges, owners })) {
      console.log(`| ${entry.metric} | ${entry.value.toLocaleString("en-US")} |`);
    }
    return;
  }

  console.log(report);

  if (args.has("--check")) {
    const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
    const invalid = rejected.filter((entry) => entry.reasons.some((reason) => reason.startsWith("forbidden_evidence")));
    const issues = companies.flatMap((company) => company.issues.map((issue) => `${company.id}: ${issue}`));
    // A claim by a company that does not exist is the one conflict shape that
    // is always a bug rather than data to review.
    const dangling = [...statuses.values()].flatMap((status) =>
      status.claimants
        .filter((claimant) => !result.companyById.has(claimant.company_id))
        .map((claimant) => `${status.domain} claimed by unknown company ${claimant.company_id}`)
    );
    console.log(`\ncheck: ${blocking.length} domains with no choosable steward, ${conflicts.length} conflicting domains, ` +
      `${invalid.length} forbidden evidence rows, ${dangling.length} dangling claims, ${issues.length} layer issues, ` +
      `${aliasRows.length} aliases, ${relationshipRows.length} relationships`);
    for (const issue of issues.slice(0, 20)) console.log(`  ${issue}`);
    for (const problem of dangling.slice(0, 20)) console.log(`  ${problem}`);
    // Conflicting evidence is DATA and does not fail a build: the resolver
    // reports a steward or names the domain contested. What fails is evidence
    // that proves nothing, a layer citing a source it may not use, or a claim
    // from a company that does not exist.
    process.exitCode = invalid.length > 0 || issues.length > 0 || dangling.length > 0 ? 1 : 0;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "companies.csv"), companiesCsv(companies));
  writeFileSync(join(OUT_DIR, "company_domains.csv"), companyDomainsCsv(companies, owners, statuses));
  writeFileSync(join(OUT_DIR, "domain_evidence.csv"), domainEvidenceCsv(companies));
  writeFileSync(join(OUT_DIR, "company_aliases.csv"), companyAliasesCsv(aliasRows));
  writeFileSync(join(OUT_DIR, "company_relationships.csv"), companyRelationshipsCsv(relationshipRows));
  writeFileSync(join(OUT_DIR, "coverage-report.md"), report + "\n");
  console.log(
    `\nWrote ${companies.length} companies, ${companies.flatMap((c) => c.domains).length} domain rows, ` +
      `${aliasRows.length} aliases, ${relationshipRows.length} relationships`
  );
  if (args.has("--sql")) {
    writeFileSync(join(OUT_DIR, "company-directory.proposed.sql"), proposedSql(companies, owners));
    console.log("Wrote data/company-directory/out/company-directory.proposed.sql (draft; never applied)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
