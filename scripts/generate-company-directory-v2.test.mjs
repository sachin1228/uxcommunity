/**
 * Tests for scripts/generate-company-directory-v2.mjs.
 *
 * The cases here are the ones that decide whether a directory row is honest:
 * a website domain that is not an email domain, one company with five domains,
 * a subsidiary that must stay its own searchable entity, two companies claiming
 * one domain, evidence that proves nothing, and the string-similarity signal
 * that must never be allowed to decide ownership.
 *
 * Run: node --test scripts/generate-company-directory-v2.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDomain,
  registrableDomain,
  domainProblems,
  nameRelatesToDomain,
  confidenceFromEvidence,
  matchKey,
  mergeDuplicates,
  registryIdentity,
  duplicateNamesWithinJurisdiction,
  resolveDomainClaims,
  resolveVerification,
  rankCompanies,
  sampleCompanies,
  loadSources,
  loadCurated,
  loadDelegations,
  loadSeeds,
  freeEmailDomains,
  toCompany,
  buildDirectory,
  companiesCsv,
  companyDomainsCsv,
  domainEvidenceCsv,
  companyAliasRows,
  companyAliasesCsv,
  companyRelationshipRows,
  companyRelationshipsCsv,
  stagedMetrics
} from "./generate-company-directory-v2.mjs";
import { readFileSync } from "node:fs";

const sources = loadSources();
const freeEmail = freeEmailDomains();
const companyOf = (record, layer = "curated") => toCompany(record, { layer, freeEmail, sources }).company;

/* ── Domain shaping: the public-suffix trap ─────────────────────────────── */

test("a country-code domain with a second-level registry label keeps three labels", () => {
  assert.equal(registrableDomain("hsbc.co.uk"), "hsbc.co.uk");
  assert.equal(registrableDomain("hsbc.com.hk"), "hsbc.com.hk", "com.hk is a suffix, not a label");
  assert.equal(registrableDomain("anz.com.au"), "anz.com.au");
  assert.equal(registrableDomain("icbc.com.cn"), "icbc.com.cn");
  assert.equal(registrableDomain("iitb.ac.in"), "iitb.ac.in");
});

test("a subdomain reduces to the registrable domain a mailbox can live on", () => {
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("mail.google.com"), "google.com");
  assert.equal(registrableDomain("aws.amazon.com"), "amazon.com");
  assert.equal(registrableDomain("example.de"), "example.de", "a bare ccTLD domain is registrable");
});

test("normalisation matches the app's own rules", () => {
  assert.equal(normalizeDomain("  WWW.Figma.com/ "), "figma.com");
  assert.equal(normalizeDomain("sachin@figma.com"), "figma.com");
  assert.equal(normalizeDomain("https://user:pw@figma.com:8443/x"), "figma.com");
  assert.equal(normalizeDomain("figma.com."), "figma.com");
  assert.equal(normalizeDomain("not a domain"), null);
});

test("a domain that cannot be a company's mail domain is refused with a reason", () => {
  assert.deepEqual(domainProblems("gmail.com", { source: "company", freeEmail }).problems, ["free_email_provider"]);
  assert.deepEqual(domainProblems("harvard.edu", { source: "company", freeEmail }).problems, ["non_company_tld"]);
  assert.deepEqual(
    domainProblems("mail.acme.com", { source: "company", freeEmail }).problems,
    ["subdomain_not_ownable"]
  );
  assert.deepEqual(domainProblems("acme.com", { source: "company", freeEmail }).problems, []);
});

test("the platform list only refuses a domain the entity's name has nothing to do with", () => {
  const shop = domainProblems("facebook.com", { source: "website", freeEmail, name: "Acme Retail" });
  assert.deepEqual(shop.problems, ["platform_not_a_company_site"]);
  // Meta's own domain, reached through the entity that operates it.
  const meta = domainProblems("facebook.com", { source: "website", freeEmail, name: "Facebook" });
  assert.deepEqual(meta.problems, []);
  // A curated email domain is never subject to the website rule.
  assert.deepEqual(
    domainProblems("google.com", { source: "company", freeEmail, name: "Acme Retail" }).problems,
    []
  );
});

/* ── Evidence: what a domain is allowed to claim ────────────────────────── */

test("confidence comes from evidence kinds, and MX alone is never proof", () => {
  assert.equal(confidenceFromEvidence([]).tier, "unknown");
  assert.equal(confidenceFromEvidence([{ type: "mx_record" }], { checked: true }).tier, "low");
  assert.equal(
    confidenceFromEvidence([{ type: "first_party_role_address" }], { checked: true }).tier,
    "medium"
  );
  assert.equal(
    confidenceFromEvidence(
      [{ type: "first_party_role_address" }, { type: "first_party_legal_page" }],
      { checked: true }
    ).tier,
    "high"
  );
});

test("unchecked evidence cannot exceed low, however much of it there is", () => {
  const evidence = [{ type: "first_party_role_address" }, { type: "first_party_legal_page" }];
  assert.equal(confidenceFromEvidence(evidence, { checked: true }).tier, "high");
  assert.equal(confidenceFromEvidence(evidence, { checked: false }).tier, "low");
});

test("a redirect is not evidence and the row is refused outright", () => {
  const result = confidenceFromEvidence([{ type: "redirect_from_website" }], { checked: true });
  assert.deepEqual(result.refused, ["redirect_from_website"]);
  const company = companyOf({
    id: "acme",
    name: "Acme",
    source: "curated",
    website_domain: "acme.com",
    domains: [
      { domain: "acme-mail.com", domain_type: "corporate_email", evidence: [{ type: "redirect_from_website" }] }
    ]
  });
  assert.ok(
    company.problems.some((problem) => problem.reasons.includes("forbidden_evidence:redirect_from_website")),
    "a redirect-backed domain is reported, not stored"
  );
  assert.equal(company.email_domains.length, 0);
});

/* ── Website domain vs employee email domain ─────────────────────────────── */

test("a website domain is a hint, never an email domain", () => {
  const company = companyOf({
    id: "meta",
    name: "Meta Platforms",
    source: "curated",
    website_domain: "meta.com",
    domains: [
      { domain: "meta.com", domain_type: "primary_website", evidence: [{ type: "external_reputable" }] },
      {
        domain: "fb.com",
        domain_type: "corporate_email",
        evidence_checked: true,
        evidence: [{ type: "first_party_legal_page" }, { type: "first_party_document" }]
      }
    ]
  });
  assert.deepEqual(company.email_domains, ["fb.com"], "only the evidenced domain is an email domain");
  assert.equal(company.website_domain, "meta.com");
  assert.equal(company.best_confidence, "high");
});

test("a company whose site is a subdomain keeps the site and owns no domain", () => {
  const company = companyOf({
    id: "aws",
    name: "Amazon Web Services",
    source: "curated",
    website_domain: "aws.amazon.com",
    domains: [{ domain: "aws.amazon.com", domain_type: "brand", evidence: [] }]
  });
  assert.equal(company.website_domain, "aws.amazon.com", "the site is still a fact about the company");
  assert.equal(company.domains.length, 0, "a subdomain of somebody else's domain is not ownable");
  assert.ok(company.problems.some((problem) => problem.reasons.includes("subdomain_not_ownable")));
});

test("name/domain similarity is a signal, never ownership", () => {
  // A legitimate abbreviation.
  assert.equal(nameRelatesToDomain("Tata Consultancy Services", "tcs.com"), true);
  // The audit's counter-example: the strings look related and that proves nothing.
  const acme = companyOf({
    id: "acme-technologies",
    name: "Acme Technologies",
    source: "curated",
    website_domain: "acmetech.io",
    domains: [{ domain: "acmetech.io", domain_type: "primary_website", evidence: [], evidence_checked: false }]
  });
  assert.equal(acme.best_confidence, "unknown");
  assert.deepEqual(acme.email_domains, [], "a lookalike domain stays a website hint");
});

/* ── One company, many domains ──────────────────────────────────────────── */

test("five domains are five domain rows on ONE company, not five companies", () => {
  const company = companyOf({
    id: "acme-holdings",
    name: "Acme Holdings",
    source: "curated",
    website_domain: "acme.com",
    domains: [
      { domain: "acme.com", domain_type: "corporate_email", evidence_checked: true, evidence: [{ type: "first_party_role_address" }, { type: "first_party_legal_page" }] },
      { domain: "acme.co.uk", domain_type: "subsidiary_email", evidence_checked: true, evidence: [{ type: "first_party_role_address" }, { type: "first_party_legal_page" }] },
      { domain: "acme.de", domain_type: "regional", evidence_checked: true, evidence: [{ type: "first_party_role_address" }, { type: "first_party_legal_page" }] },
      { domain: "brand.com", domain_type: "brand", evidence: [], evidence_checked: false },
      { domain: "acme.org", domain_type: "historical", evidence: [], evidence_checked: false }
    ]
  });
  assert.equal(company.domains.length, 5);
  assert.deepEqual(company.email_domains, ["acme.co.uk", "acme.com", "acme.de"]);
  assert.equal(company.domains.every((row) => row.verified === false), true, "a seed never verifies anything");
});

test("a free consumer provider can never be a company's domain", () => {
  const company = companyOf({
    id: "microsoft",
    name: "Microsoft",
    source: "curated",
    website_domain: "microsoft.com",
    domains: [{ domain: "hotmail.com", domain_type: "consumer_service", evidence: [] }]
  });
  assert.ok(company.problems.some((problem) => problem.reasons.includes("free_email_provider")));
  assert.ok(company.issues.includes("unknown_domain_type:consumer_service"));
  assert.deepEqual(company.email_domains, []);
});

/* ── Ownership: one domain, one company ─────────────────────────────────── */

test("two companies claiming one domain at equal confidence leaves it contested, not resolved", () => {
  const first = companyOf({
    id: "acme",
    name: "Acme",
    source: "curated",
    domains: [{ domain: "acme.com", domain_type: "corporate_email", evidence_checked: true, evidence: [{ type: "published_email_format" }, { type: "external_reputable" }] }]
  });
  const second = companyOf({
    id: "acme-global",
    name: "Acme Global",
    source: "curated",
    domains: [{ domain: "acme.com", domain_type: "corporate_email", evidence_checked: true, evidence: [{ type: "published_email_format" }, { type: "external_reputable" }] }]
  });
  const { owners, statuses, conflicts } = resolveDomainClaims([first, second]);
  assert.equal(owners.get("acme.com"), null, "no steward is chosen from a tie");
  assert.equal(statuses.get("acme.com").status, "contested");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "blocking");
  assert.equal(conflicts[0].claimants.length, 2);
  // Both claims survive: a conflict is data to review, not a row to delete.
  assert.equal(first.domains.length, 1);
  assert.equal(second.domains.length, 1);
});

test("a stronger claim is the steward and the weaker claim is still kept", () => {
  const strong = companyOf({
    id: "acme",
    name: "Acme",
    source: "curated",
    domains: [{ domain: "acme.com", domain_type: "corporate_email", evidence_checked: true, evidence: [{ type: "first_party_role_address" }, { type: "first_party_legal_page" }] }]
  });
  const weak = companyOf({
    id: "acme-labs",
    name: "Acme Labs",
    source: "curated",
    domains: [{ domain: "acme.com", domain_type: "primary_website", evidence: [] }]
  });
  const { owners, statuses, conflicts } = resolveDomainClaims([strong, weak]);
  assert.equal(owners.get("acme.com"), "acme");
  assert.equal(statuses.get("acme.com").status, "resolved");
  assert.equal(conflicts.length, 1, "the disagreement is still reported");
  assert.equal(conflicts[0].severity, "review");
  assert.equal(statuses.get("acme.com").claimants.length, 2, "the weaker claim is kept");
});

test("a low claim can be reclassified by a medium one, and superseded by a proof without data loss", () => {
  const low = companyOf({
    id: "company-a",
    name: "Company A",
    source: "curated",
    domains: [{ domain: "example.com", domain_type: "primary_website", evidence: [] }]
  });
  assert.equal(low.domains[0].confidence, "unknown");
  const medium = companyOf({
    id: "company-b",
    name: "Company B",
    source: "curated",
    domains: [{ domain: "example.com", domain_type: "corporate_email", evidence_checked: true, evidence: [{ type: "first_party_role_address" }] }]
  });

  // 1. Both claims exist; the evidence decides the steward.
  const resolved = resolveDomainClaims([low, medium]);
  assert.equal(resolved.statuses.get("example.com").status, "resolved");
  assert.equal(resolved.owners.get("example.com"), "company-b");
  const aClaim = resolved.statuses.get("example.com").claimants.find((c) => c.company_id === "company-a");
  assert.equal(aClaim.confidence, "unknown", "a plain website row carries no email evidence");
  assert.equal(aClaim.superseded, false, "superseded means a PROOF exists, not a stronger opinion");

  // 2. B proves the domain. A's hint is superseded - and still there.
  const verified = resolveDomainClaims([low, medium], { verifiedClaims: [{ domain: "example.com", company_id: "company-b" }] });
  assert.equal(verified.statuses.get("example.com").status, "verified");
  assert.equal(verified.statuses.get("example.com").claimants.find((c) => c.company_id === "company-a").superseded, true);
  assert.equal(low.domains.length, 1, "A's row is reclassified in the report, not deleted");
  assert.equal(verified.conflicts.length, 1, "and the disagreement is still visible");
});

/* ── The verification decision table (A–I) ──────────────────────────────── */

/** A claim map as buildDirectory produces it, for the decision tests. */
function claimsFor(companies, verifiedClaims = []) {
  const resolved = resolveDomainClaims(companies, { verifiedClaims });
  return {
    ...resolved,
    companyById: new Map(companies.map((company) => [company.id, company])),
    claimsByDomain: resolved.statuses
  };
}

/** A company with one claim on `domain`; `confidence` picks the evidence behind it. */
const claim = (id, name, domain, { type = "corporate_email", confidence = "medium" } = {}) =>
  companyOf({
    id,
    name,
    source: "curated",
    domains: [
      {
        domain,
        domain_type: type,
        evidence_checked: true,
        evidence: confidence === "medium" ? [{ type: "first_party_role_address" }] : []
      }
    ]
  });

test("A. selected company + its own verified domain verifies as that company", () => {
  const figma = claim("figma", "Figma", "figma.com");
  const world = claimsFor([figma], [{ domain: "figma.com", company_id: "figma" }]);
  const decision = resolveVerification({ domain: "figma.com", selectedCompanyId: "figma", ...world });
  assert.equal(decision.outcome, "verify_as_selected");
  assert.equal(decision.reason, "verified_by_selected");
});

test("B. selected company + its own unverified hint verifies as that company", () => {
  const acme = claim("acme", "Acme", "acme.com", { type: "primary_website", confidence: "none" });
  const world = claimsFor([acme]);
  const decision = resolveVerification({ domain: "acme.com", selectedCompanyId: "acme", ...world });
  assert.equal(decision.outcome, "verify_as_selected");
  assert.equal(decision.reason, "website_hint");
});

test("C. domain verified by another company sends the member to that company", () => {
  const figma = claim("figma", "Figma", "figma.com");
  const google = claim("google", "Google", "google.com");
  const world = claimsFor([figma, google], [{ domain: "figma.com", company_id: "figma" }]);
  const decision = resolveVerification({ domain: "figma.com", selectedCompanyId: "google", ...world });
  assert.equal(decision.outcome, "join_other_company");
  assert.equal(decision.reason, "verified_by_other_company");
  assert.deepEqual(decision.steward, { company_id: "figma", company_name: "Figma" });
});

test("D. conflicting evidence still lets a claimant verify: the proof decides", () => {
  const a = claim("company-a", "Company A", "example.com");
  const b = claim("company-b", "Company B", "example.com");
  const world = claimsFor([a, b]);
  const decision = resolveVerification({ domain: "example.com", selectedCompanyId: "company-a", ...world });
  assert.equal(decision.outcome, "verify_as_selected");
  assert.equal(decision.reason, "contested_claim");
  assert.equal(decision.claimants.length, 2);
});

test("E/F. a relationship never transfers a domain; a reviewed delegation does", () => {
  const meta = claim("meta", "Meta Platforms", "meta.com");
  const whatsapp = companyOf({
    id: "whatsapp",
    name: "WhatsApp",
    source: "curated",
    domains: [{ domain: "whatsapp.com", domain_type: "primary_website", evidence: [] }]
  });
  // 1. Meta has PROVED meta.com and WhatsApp has no claim and no delegation:
  // the member is sent to Meta. A relationship never transfers a domain.
  const verified = claimsFor([meta, whatsapp], [{ domain: "meta.com", company_id: "meta" }]);
  const refused = resolveVerification({ domain: "meta.com", selectedCompanyId: "whatsapp", ...verified });
  assert.equal(refused.outcome, "join_other_company");
  assert.equal(refused.reason, "verified_by_other_company");
  assert.equal(refused.steward.company_id, "meta");

  // 2. Nobody has proved meta.com yet, and the delegation is unreviewed: it
  // grants nothing, and the refusal says which of the two reasons applies.
  const unproved = claimsFor([meta, whatsapp]);
  const unreviewed = resolveVerification({
    domain: "meta.com",
    selectedCompanyId: "whatsapp",
    delegations: [{ company_id: "whatsapp", domain: "meta.com", granted_by: "meta", evidence_checked: false, effective: false }],
    ...unproved
  });
  assert.equal(unreviewed.outcome, "domain_unclaimed_by_selected");
  assert.equal(unreviewed.reason, "delegation_not_reviewed");

  // 3. A reviewed, evidenced delegation lets the subsidiary's staff verify -
  // and the steward is still recorded as the parent that owns the domain.
  const delegated = resolveVerification({
    domain: "meta.com",
    selectedCompanyId: "whatsapp",
    delegations: [{ company_id: "whatsapp", domain: "meta.com", granted_by: "meta", evidence_checked: true, effective: true }],
    ...verified
  });
  assert.equal(delegated.outcome, "verify_via_delegation");
  assert.equal(delegated.reason, "delegated_by_steward");
  assert.equal(delegated.steward.company_id, "meta");
});

test("G. an unlisted domain means create the company, not guess one", () => {
  const figma = claim("figma", "Figma", "figma.com");
  const world = claimsFor([figma]);
  const decision = resolveVerification({ domain: "brand-new.example", newCompanyName: "Brand New", nameMatchesDomain: true, ...world });
  assert.equal(decision.outcome, "create_company_for_domain");
});

test("H. a weak unrelated hint does not block a real company from being created", () => {
  const wrongHint = claim("wrong-co", "Wrong Co", "realbrand.com", { type: "primary_website", confidence: "none" });
  const world = claimsFor([wrongHint]);
  // The hint is LOW (its evidence is unchecked/absent), and its name does not
  // match: the new company may prove the domain, and the hint is superseded.
  const decision = resolveVerification({
    domain: "realbrand.com",
    newCompanyName: "Real Brand",
    nameMatchesDomain: true,
    ...world
  });
  assert.equal(decision.outcome, "create_company_for_domain");
  assert.deepEqual(decision.supersedes, ["wrong-co"]);

  // A claim at medium or better still has to be joined: opinion is not proof,
  // but neither is it nothing.
  const strongHint = claim("right-co", "Right Co", "realbrand.com", { confidence: "medium" });
  const blocked = resolveVerification({
    domain: "realbrand.com",
    newCompanyName: "Real Brand",
    nameMatchesDomain: true,
    ...claimsFor([strongHint])
  });
  assert.equal(blocked.outcome, "join_other_company");
  assert.equal(blocked.reason, "claimed_at_medium_or_better");
});

test("H2. creating under an existing company's name joins that company instead", () => {
  // Deliberately a WEAK claim: the name is what decides here, so the rule that
  // protects against duplicate entities is the one being exercised.
  const figma = claim("figma", "Figma", "figma.com", { type: "primary_website", confidence: "none" });
  const world = claimsFor([figma]);
  const decision = resolveVerification({ domain: "figma.com", newCompanyName: "Figma", nameMatchesDomain: true, ...world });
  assert.equal(decision.outcome, "join_other_company");
  assert.equal(decision.reason, "same_company_name");
  assert.equal(decision.steward.company_id, "figma");
});

test("H3. a name that does not match the domain is refused before anything is written", () => {
  const world = claimsFor([]);
  const decision = resolveVerification({ domain: "randomco.com", newCompanyName: "Microsoft", nameMatchesDomain: false, ...world });
  assert.equal(decision.outcome, "name_does_not_match_domain");
});

test("I. a domain reassigned after a relationship change is re-proven, and members keep their row", () => {
  const oldOwner = claim("acquired-co", "Acquired Co", "acquired.com");
  const newOwner = claim("acquirer-co", "Acquirer Co", "acquirer.com");
  // Before the change: the acquired company's domain is verified to it.
  const before = claimsFor([oldOwner, newOwner], [{ domain: "acquired.com", company_id: "acquired-co" }]);
  assert.equal(
    resolveVerification({ domain: "acquired.com", selectedCompanyId: "acquirer-co", ...before }).outcome,
    "join_other_company",
    "the acquirer cannot claim the acquired company's domain until it is reassigned"
  );
  // After a reassignment the verified row moves, so the new owner verifies and
  // the old one is superseded - neither membership history nor the row is lost.
  const after = claimsFor([oldOwner, newOwner], [{ domain: "acquired.com", company_id: "acquirer-co" }]);
  assert.equal(
    resolveVerification({ domain: "acquired.com", selectedCompanyId: "acquirer-co", ...after }).outcome,
    "verify_as_selected"
  );
  assert.equal(after.statuses.get("acquired.com").claimants.find((c) => c.company_id === "acquired-co").superseded, true);
  assert.equal(after.statuses.get("acquired.com").claimants.length, 1);
});

/* ── The Meta family, domain by domain ─────────────────────────────────── */

test("Meta, Facebook, Instagram and WhatsApp are four entities and four domains", () => {
  const { companies, statuses, companyById, delegations } = buildDirectory({ sample: null });
  const byId = new Map(companies.map((company) => [company.id, company]));
  for (const id of ["meta-platforms", "facebook", "instagram", "whatsapp"]) {
    assert.ok(byId.has(id), `${id} is a searchable company`);
  }

  // Four separate entities, not one collapsed group.
  assert.equal(new Set(["meta-platforms", "facebook", "instagram", "whatsapp"]).size, 4);
  // The relationships record the structure without merging anybody.
  assert.equal(byId.get("facebook").parent_company_id, "meta-platforms");
  assert.equal(byId.get("instagram").parent_company_id, "meta-platforms");
  assert.equal(byId.get("whatsapp").parent_company_id, "meta-platforms");

  // Domain by domain: who may verify, and why.
  const cases = [
    ["meta.com", "meta-platforms"],
    ["facebook.com", "facebook"],
    ["instagram.com", "instagram"],
    ["whatsapp.com", "whatsapp"]
  ];
  for (const [domain, expectedSteward] of cases) {
    assert.equal(statuses.get(domain)?.steward, expectedSteward, `${domain} is stewarded by ${expectedSteward}`);
    const own = resolveVerification({
      domain,
      selectedCompanyId: expectedSteward,
      claimsByDomain: statuses,
      companyById
    });
    assert.equal(own.outcome, "verify_as_selected", `${expectedSteward} may verify ${domain}`);
  }

  // The domains are not interchangeable: nobody else may verify on them.
  for (const [domain, owner] of cases) {
    for (const other of ["meta-platforms", "facebook", "instagram", "whatsapp"]) {
      if (other === owner) continue;
      const decision = resolveVerification({ domain, selectedCompanyId: other, claimsByDomain: statuses, companyById, delegations });
      assert.equal(decision.outcome, "domain_unclaimed_by_selected", `${other} may NOT verify ${domain}`);
      assert.equal(decision.steward.company_id, owner);
    }
  }

  // WhatsApp does not inherit Meta's mail domain, and Meta does not inherit
  // its subsidiaries'.
  assert.ok(!byId.get("whatsapp").domains.some((row) => row.domain === "meta.com"));
  assert.ok(!byId.get("meta-platforms").domains.some((row) => row.domain === "whatsapp.com"));
  assert.ok(!byId.get("meta-platforms").domains.some((row) => row.domain === "facebook.com"));

  // And the shipped data contains no delegation that would allow otherwise.
  assert.deepEqual(loadDelegations(), []);
});

/* ── Entities: subsidiaries stay searchable, duplicates merge ───────────── */

test("Meta, WhatsApp and Instagram stay three entities with recorded relationships", () => {
  const { companies } = buildDirectory({ sample: null });
  const meta = companies.find((company) => company.id === "meta-platforms");
  const whatsapp = companies.find((company) => company.id === "whatsapp");
  const instagram = companies.find((company) => company.id === "instagram");
  assert.ok(meta && whatsapp && instagram, "all three are searchable companies");
  assert.equal(whatsapp.parent_company_id, "meta-platforms");
  assert.equal(instagram.parent_company_id, "meta-platforms");
  // The subsidiary does not get the parent's mail domain, and vice versa.
  assert.deepEqual(whatsapp.email_domains, []);
  assert.ok(!whatsapp.domains.some((row) => row.domain === "fb.com"));
  assert.ok(!meta.domains.some((row) => row.domain === "whatsapp.com"));
});

test("one employer spelled two ways becomes one row", () => {
  const base = { source: "curated", domains: [], aliases: [] };
  const { companies, merges } = mergeDuplicates([
    { ...base, id: "alphabet", name: "Alphabet Inc.", layer: "curated", domains: [{ domain: "abc.xyz" }] },
    { ...base, id: "alphabet-inc", name: "Alphabet Inc", layer: "seed", domains: [{ domain: "abc.xyz" }] },
    { ...base, id: "acme", name: "Acme Ltd", layer: "seed", domains: [] }
  ]);
  assert.equal(companies.length, 2);
  assert.equal(merges.length, 1);
  assert.equal(merges[0].kept, "alphabet");
  assert.equal(matchKey("Alphabet Inc."), matchKey("Alphabet Inc"));
  assert.equal(matchKey("Acme Ltd"), "acme");
});

test("two same-named companies in two jurisdictions are two companies", () => {
  const base = { source: "companies_house", domains: [], aliases: [] };
  const { companies, merges } = mergeDuplicates([
    { ...base, id: "nordic-gb", name: "Nordic Holdings Ltd", jurisdiction: "GB", layer: "registry" },
    { ...base, id: "nordic-de", name: "Nordic Holdings Ltd", jurisdiction: "DE", layer: "registry" },
    { ...base, id: "nordic-gb-again", name: "Nordic Holdings Ltd", jurisdiction: "GB", layer: "registry" }
  ]);
  assert.equal(companies.length, 2, "the GB pair merges; the DE company stays its own row");
  assert.equal(merges.length, 1);
  assert.equal(merges[0].kept, "nordic-gb");
  assert.ok(companies.some((company) => company.id === "nordic-de"));
});

test("a registry number identifies an entity that has changed its name", () => {
  const base = { source: "companies_house", aliases: [], domains: [] };
  const { companies, merges } = mergeDuplicates([
    { ...base, id: "old-name", name: "Tunnock's Ltd", source_id: "SC009876", jurisdiction: "GB", layer: "registry" },
    { ...base, id: "new-name", name: "Tunnock's Group Ltd", source_id: "SC009876", jurisdiction: "GB", layer: "registry" }
  ]);
  assert.equal(companies.length, 1, "the registry number wins over the name");
  assert.equal(merges.length, 1);
  assert.equal(companies[0].source_id, "SC009876");
});

test("a name match never merges two different registry entities", () => {
  const base = { source: "companies_house", aliases: [], domains: [] };
  const { companies } = mergeDuplicates([
    { ...base, id: "one", name: "Everest Ltd", source_id: "00000001", jurisdiction: "GB", layer: "registry" },
    { ...base, id: "two", name: "Everest Ltd", source_id: "00000002", jurisdiction: "GB", layer: "registry" }
  ]);
  assert.equal(companies.length, 2, "two legal entities that happen to share a name stay two rows");
});

test("the layer record's own identifiers reach the company and the CSV", () => {
  const company = companyOf({
    name: "Registry Example Ltd",
    country: "GB",
    jurisdiction: "GB",
    source: "companies_house",
    source_id: "12345678",
    domains: []
  });
  assert.equal(company.source_id, "12345678");
  assert.equal(company.jurisdiction, "GB");
  const csv = companiesCsv([company], new Map()).split("\n");
  const header = csv[0].split(",");
  const row = csv[1].split(",");
  assert.equal(row[header.indexOf("source_id")], "12345678");
  assert.equal(row[header.indexOf("jurisdiction")], "GB");
});

test("name ambiguity is counted within a jurisdiction, not across them", () => {
  const companies = [
    { name: "Nordic Holdings Ltd", jurisdiction: "GB" },
    { name: "Nordic Holdings Ltd", jurisdiction: "DE" },
    { name: "Nordic Holdings Ltd", jurisdiction: "GB" }
  ];
  assert.equal(duplicateNamesWithinJurisdiction(companies), 1);
});

test("a curated entity absorbs its discovery row and keeps the extra domains", () => {
  const { companies } = buildDirectory({ sample: null });
  const google = companies.find((company) => company.id === "google");
  assert.equal(google.layer, "curated");
  assert.deepEqual(google.email_domains, ["google.com"]);
  assert.ok(google.domains.some((row) => row.domain === "google.com"));
});

/* ── Ranking and sampling ───────────────────────────────────────────────── */

test("ranking is deterministic and says what it was based on", () => {
  const companies = [
    { id: "b", name: "Beta", normalized_name: "beta", email_domains: [], best_confidence: "unknown", email_evidence_score: 0, sitelinks: 40 },
    { id: "a", name: "Acme", normalized_name: "acme", email_domains: ["acme.com"], best_confidence: "high", email_evidence_score: 2, sitelinks: 0 },
    { id: "c", name: "Gamma", normalized_name: "gamma", email_domains: [], best_confidence: "unknown", email_evidence_score: 0, sitelinks: 0 }
  ];
  const first = rankCompanies(companies.map((company) => ({ ...company })));
  const second = rankCompanies(companies.map((company) => ({ ...company })));
  assert.deepEqual(first.map((company) => company.id), second.map((company) => company.id));
  assert.deepEqual(first.map((company) => company.id), ["a", "b", "c"]);
  assert.deepEqual(first.map((company) => company.rank_basis), ["email_evidence", "wikidata_sitelinks", "name_only"]);
});

test("a sample always includes the curated entities", () => {
  const companies = rankCompanies(
    Array.from({ length: 50 }, (_, index) => ({
      id: `seed-${index}`,
      name: `Seed ${index}`,
      normalized_name: `seed ${index}`,
      layer: "seed",
      email_domains: [],
      best_confidence: "unknown",
      email_evidence_score: 0,
      sitelinks: 0
    }))
  );
  const curated = { ...companies[0], id: "curated-one", layer: "curated" };
  const sample = sampleCompanies([curated, ...companies], 5);
  assert.equal(sample.length, 5);
  assert.ok(sample.some((company) => company.id === "curated-one"));
});

/* ── The output contract ────────────────────────────────────────────────── */

test("the CSVs carry exactly the documented columns", () => {
  const { companies, owners, statuses, relationships } = buildDirectory({ sample: 100 });
  const aliasRows = companyAliasRows(companies);
  // companies.csv is the ENTITY and nothing else: the domain columns, the alias
  // string and the parent column are gone, because each of them is a second copy
  // of a fact that has its own file and its own table. A column the importer
  // ignores is a column nothing keeps honest.
  assert.equal(
    companiesCsv(companies).split("\n")[0],
    "company_id,company_name,country,industry,source,source_id,jurisdiction,source_confidence,directory_rank"
  );
  const domainHeader = companyDomainsCsv(companies, owners, statuses).split("\n")[0];
  assert.equal(
    domainHeader,
    "company_id,domain,domain_type,verified,source,source_url,evidence_confidence,evidence_count,evidence_types,claim_status,steward_company_id,first_seen_at,last_verified_at"
  );
  const rows = companyDomainsCsv(companies, owners, statuses).trim().split("\n").slice(1);
  assert.ok(rows.length > 0);
  assert.equal(
    rows.every((row) => row.split(",")[3] === "false"),
    true,
    "nothing a data file produces is verified"
  );
  assert.equal(
    domainEvidenceCsv(companies).split("\n")[0],
    "company_id,domain,evidence_type,source_url,source,checked,observed_at"
  );
  assert.equal(
    companyAliasesCsv(aliasRows).split("\n")[0],
    "company_id,alias,alias_type,source"
  );
  assert.equal(
    companyRelationshipsCsv(companyRelationshipRows(relationships, companies)).split("\n")[0],
    "parent_company_id,child_company_id,relationship_type,source"
  );
});

test("the staged metrics cover the nine required figures", () => {
  const { companies, owners, conflicts, merges } = buildDirectory({ sample: 100 });
  const metrics = stagedMetrics({ companies, conflicts, merges, owners });
  assert.deepEqual(metrics.map((entry) => entry.metric), [
    "companies",
    "unique domains",
    "website-only domains",
    "high-confidence email domains",
    "medium-confidence email domains",
    "low-confidence email domains",
    "domains with conflicting evidence",
    "unresolved companies (no email domain of their own)",
    "duplicate entities merged"
  ]);
  assert.equal(metrics[0].value, 100);
});

test("evidence observations are emitted with their URL and checked flag", () => {
  const company = companyOf({
    id: "figma",
    name: "Figma",
    source: "curated",
    domains: [
      {
        domain: "figma.com",
        domain_type: "corporate_email",
        evidence_checked: true,
        evidence: [
          { type: "first_party_role_address", url: "https://figma.com/contact" },
          { type: "mx_record", url: "https://www.rfc-editor.org/rfc/rfc7483" }
        ]
      }
    ]
  });
  const csv = domainEvidenceCsv([company]);
  const rows = csv.trim().split("\n").slice(1);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.includes("first_party_role_address") && row.includes("https://figma.com/contact") && row.endsWith(",true,")));
  // The observation carries its provenance, so `domain_evidence.source` in the
  // database is not an empty string after a round trip.
  assert.ok(rows.every((row) => row.split(",")[4] === "curated"));
});

test("an unknown evidence kind is a layer bug, not a silent zero weight", () => {
  const company = companyOf({
    id: "acme",
    name: "Acme",
    source: "curated",
    domains: [{ domain: "acme.com", domain_type: "corporate_email", evidence_checked: true, evidence: [{ type: "looks_legit" }] }]
  });
  assert.ok(company.issues.includes("unknown_evidence_type:looks_legit"));
  assert.equal(company.domains[0].confidence, "unknown", "an unknown kind adds no weight");
});

test("the build is deterministic: same inputs, same bytes", () => {
  const first = buildDirectory({ sample: 200 });
  const second = buildDirectory({ sample: 200 });
  assert.equal(companiesCsv(first.companies), companiesCsv(second.companies));
  assert.equal(
    companyDomainsCsv(first.companies, first.owners),
    companyDomainsCsv(second.companies, second.owners)
  );
  assert.equal(
    companyAliasesCsv(companyAliasRows(first.companies)),
    companyAliasesCsv(companyAliasRows(second.companies))
  );
  assert.equal(
    companyRelationshipsCsv(companyRelationshipRows(first.relationships, first.companies)),
    companyRelationshipsCsv(companyRelationshipRows(second.relationships, second.companies))
  );
});

/* ── The alias and relationship feeds ───────────────────────────────────── */

test("aliases carry their type, and the canonical name is not one of them", () => {
  const { companies } = buildDirectory({ sample: 1000 });
  const rows = companyAliasRows(companies);
  const meta = companies.find((company) => company.id === "meta-platforms");
  assert.deepEqual(
    rows
      .filter((row) => row.company_id === "meta-platforms")
      .map((row) => `${row.alias}:${row.alias_type}`)
      .sort(),
    ["Facebook Inc.:former_name", "Facebook, Inc.:former_name", "Meta:alias", "Meta Platforms Inc.:alias"].sort()
  );
  // The name lives in companies.csv. Repeating it here is the second copy the
  // export contract exists to remove.
  assert.equal(
    rows.some((row) => row.company_id === "meta-platforms" && row.alias === meta.name),
    false
  );
  // A former name is search-only, so it must not have folded Meta and the
  // Facebook brand entity into one row.
  assert.ok(companies.some((company) => company.id === "facebook"));
});

test("the alias feed collapses a repeat and refuses an unusable alias", () => {
  const companies = [
    {
      id: "acme",
      name: "Acme",
      source: "curated",
      aliases: ["Acme Inc.", "ACME INC."],
      former_names: ["Acme Incorporated"]
    }
  ];
  const rows = companyAliasRows(companies);
  assert.deepEqual(rows.map((row) => `${row.alias}:${row.alias_type}`).sort(), [
    "Acme Inc.:alias",
    "Acme Incorporated:former_name"
  ]);
  assert.throws(() => companyAliasRows([{ id: "acme", name: "Acme", aliases: ["x".repeat(121)] }]), /longer than 120/);
});

test("the relationship feed keeps both authored directions", () => {
  const { companies, relationships } = buildDirectory({ sample: 1000 });
  const rows = companyRelationshipRows(relationships, companies);
  assert.equal(rows.length, 17, "every curated edge reaches the feed");
  assert.ok(rows.every((row) => row.source === "curated"));
  assert.ok(
    rows.some(
      (row) =>
        row.parent_company_id === "meta-platforms" &&
        row.child_company_id === "facebook" &&
        row.relationship_type === "brand"
    )
  );
  assert.ok(
    rows.some(
      (row) =>
        row.parent_company_id === "facebook" &&
        row.child_company_id === "meta-platforms" &&
        row.relationship_type === "parent"
    )
  );
  const TYPES = new Set(["parent", "subsidiary", "brand", "division", "acquired_company", "former_name"]);
  assert.ok(rows.every((row) => TYPES.has(row.relationship_type)), "only the database's vocabulary is written");
});

test("a bad relationship fails the build instead of becoming a rejected row", () => {
  const companies = [{ id: "acme" }, { id: "holdings" }];
  const edge = (from, child, type) => [{ from, child, type }];
  assert.throws(() => companyRelationshipRows(edge("acme", "ghost", "subsidiary"), companies), /outside the export/);
  assert.throws(() => companyRelationshipRows(edge("acme", "acme", "subsidiary"), companies), /self relationship/);
  assert.throws(() => companyRelationshipRows(edge("holdings", "acme", "owns"), companies), /unknown relationship_type/);
  assert.equal(
    companyRelationshipRows([...edge("holdings", "acme", "subsidiary"), ...edge("holdings", "acme", "subsidiary")], companies)
      .length,
    1,
    "the same edge stated twice is one row"
  );
});

/* ── Inputs ─────────────────────────────────────────────────────────────── */

test("every curated entity cites a source the registry knows", () => {
  const known = new Set(sources.keys());
  for (const entity of loadCurated()) {
    assert.ok(known.has(entity.source), `${entity.id} cites ${entity.source}`);
  }
});

test("the seed layer is website domains only", () => {
  const seeds = loadSeeds();
  assert.equal(seeds.length, 1);
  for (const entity of seeds[0].entities.slice(0, 500)) {
    assert.equal(entity.domains.length, 1);
    assert.equal(entity.domains[0].domain_type, "primary_website");
  }
});

test("the committed seed layer is the v1 seed, kept as data rather than a migration", () => {
  // The v1 seed migration is gone from the repository and its retained copy is
  // this layer, so it is now the single source for both the directory build and
  // the reset that names the rows to remove (docs/company-directory-reset.md).
  const entities = loadSeeds()[0].entities;
  assert.equal(entities.length, 4574);
  assert.equal(new Set(entities.map((entity) => entity.id)).size, 4574);
  assert.equal(entities.every((entity) => entity.domains.length === 1), true);
  assert.equal(entities.every((entity) => entity.domains[0].domain_type === "primary_website"), true);
  // A website domain, never a claim about where employees receive mail.
  assert.equal(entities.every((entity) => entity.domains[0].evidence.length === 0), true);
  assert.equal(entities.every((entity) => entity.domains[0].evidence_checked === false), true);
  assert.equal(entities.every((entity) => entity.website_domain === entity.domains[0].domain), true);
});

/* ── The two bugs the review found in the shipped seed ──────────────────── */

// The v1 seed migration was removed from the repository; the seed layer is its
// retained copy and holds exactly the rows these two tests are about.
const SEED_ENTITIES = loadSeeds()[0].entities;

test("the committed seed passes today's gates, which it did not before", () => {
  // The v1 generator's own deny list rejected 53 of the rows the v1 seed
  // contains (google.com among them, kept only because the hand-checked core
  // bypassed the gates), so the committed migration was not reproducible from
  // the committed generator. Every seeded row has to pass the gates now,
  // whichever layer it is read as.
  const entities = SEED_ENTITIES;
  assert.ok(entities.length >= 4000, "the seed is the real directory");

  for (const source of ["website", "curated"]) {
    const refused = entities.filter(
      (entity) =>
        domainProblems(entity.website_domain, { source, freeEmail, name: entity.name }).problems.length > 0
    );
    assert.deepEqual(
      refused.map((entity) => `${entity.name} → ${entity.website_domain}`),
      [],
      `no seeded row may be refused as a ${source} row`
    );
  }
});

test("bare country-code domains survive, because the seed is full of them", () => {
  // The v1 gate rejected any two-label domain on a two-letter TLD as a
  // "truncated URL", which silently excluded every company whose site is
  // example.de / example.in / example.co. 47 of the committed seed's rows are
  // exactly that shape, and they all come from the hand-checked core.
  const entities = SEED_ENTITIES;
  const bare = entities.filter((entity) => /^[a-z0-9-]+\.[a-z]{2}$/.test(entity.website_domain));
  assert.ok(bare.length > 0, "the directory contains two-label ccTLD domains");

  for (const entity of bare) {
    const result = domainProblems(entity.website_domain, {
      source: "curated",
      freeEmail,
      name: entity.name
    });
    assert.deepEqual(result.problems, [], `${entity.website_domain} must be usable`);
    assert.equal(result.domain, entity.website_domain, "and must not be reduced to anything else");
  }
});
