#!/usr/bin/env node

/**
 * Tests for the directory importer's validation and dry-run reporting.
 *
 *   node --test scripts/import-company-directory.test.mjs
 *
 * What is worth testing here is the part that runs before a single row is
 * written: what the loader refuses, and what the dry run tells an operator about
 * an export. The SQL side (staging, the set-based merge, the guards that stop it
 * touching a proof) is exercised against a real database by
 * `npm run bench:companies-directory`, which loads every tier through this same
 * script.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { datasetReport, parseCsv, stageRows, uuidv5 } from "./import-company-directory.mjs";

const COMPANY = { company_id: "acme", company_name: "Acme Ltd" };

test("deterministic ids are a pure function of the slug", () => {
  assert.equal(uuidv5("acme"), uuidv5("acme"));
  assert.notEqual(uuidv5("acme"), uuidv5("acme-2"));
  assert.match(uuidv5("acme"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("an export that claims a domain is verified is refused, not trusted", () => {
  const staged = stageRows({
    companies: [COMPANY],
    domains: [{ company_id: "acme", domain: "acme.com", verified: "true" }],
    evidence: []
  });
  assert.equal(staged.domainRows.length, 0);
  assert.deepEqual(staged.rejected[0], ["company_domains.csv", "acme/acme.com", "export_claims_verified", ""]);
});

test("a domain whose company is missing is rejected rather than invented", () => {
  const staged = stageRows({
    companies: [COMPANY],
    domains: [{ company_id: "ghost", domain: "ghost.com" }],
    evidence: []
  });
  assert.deepEqual(staged.rejected[0], ["company_domains.csv", "ghost/ghost.com", "unknown_company", ""]);
});

test("a duplicate company in one export is reported, not silently merged", () => {
  const staged = stageRows({
    companies: [COMPANY, { company_id: "acme", company_name: "Acme Ltd" }],
    domains: [],
    evidence: []
  });
  assert.equal(staged.companyRows.length, 1);
  assert.equal(staged.rejected[0][2], "duplicate_slug_in_export");
});

test("aliases are typed, and only the documented types are accepted", () => {
  const ok = stageRows({
    companies: [COMPANY],
    domains: [],
    evidence: [],
    aliases: [{ company_id: "acme", alias: "Acme Incorporated", alias_type: "former_name" }]
  });
  assert.equal(ok.aliasRows.length, 1);
  assert.equal(ok.aliasRows[0].alias_type, "former_name");

  const bad = stageRows({
    companies: [COMPANY],
    domains: [],
    evidence: [],
    aliases: [{ company_id: "acme", alias: "Acme", alias_type: "guessing" }]
  });
  assert.equal(bad.aliasRows.length, 0);
  assert.equal(bad.rejected[0][2], "invalid_alias_type");
});

test("an alias cannot be added twice in one export", () => {
  const staged = stageRows({
    companies: [COMPANY],
    domains: [],
    evidence: [],
    aliases: [
      { company_id: "acme", alias: "Acme Ltd", alias_type: "alias" },
      { company_id: "acme", alias: "acme ltd", alias_type: "alias" }
    ]
  });
  assert.equal(staged.aliasRows.length, 1);
  assert.equal(staged.rejected[0][2], "duplicate_alias_in_export");
});

test("relationships need both ends in the export, a real type, and two different companies", () => {
  const companies = [COMPANY, { company_id: "acme-holdings", company_name: "Acme Holdings" }];

  const ok = stageRows({
    companies,
    domains: [],
    evidence: [],
    relationships: [
      { parent_company_id: "acme-holdings", child_company_id: "acme", relationship_type: "subsidiary" }
    ]
  });
  assert.equal(ok.relationshipRows.length, 1);

  const dangling = stageRows({
    companies,
    domains: [],
    evidence: [],
    relationships: [
      { parent_company_id: "nobody", child_company_id: "acme", relationship_type: "subsidiary" }
    ]
  });
  assert.equal(dangling.relationshipRows.length, 0);
  assert.equal(dangling.rejected[0][2], "unknown_company");

  const self = stageRows({
    companies,
    domains: [],
    evidence: [],
    relationships: [
      { parent_company_id: "acme", child_company_id: "acme", relationship_type: "subsidiary" }
    ]
  });
  assert.equal(self.rejected[0][2], "self_relationship");

  const badType = stageRows({
    companies,
    domains: [],
    evidence: [],
    relationships: [
      { parent_company_id: "acme-holdings", child_company_id: "acme", relationship_type: "owns" }
    ]
  });
  assert.equal(badType.rejected[0][2], "invalid_relationship_type");
});

test("the dry run reports the export's own disagreement before anything is written", () => {
  const companies = [
    { company_id: "acme", company_name: "Acme Ltd" },
    { company_id: "acme", company_name: "Acme Limited" },
    { company_id: "globex", company_name: "Globex" },
    { company_id: "initech", company_name: "Initech" }
  ];
  const domains = [
    { company_id: "acme", domain: "acme.com", evidence_confidence: "medium" },
    { company_id: "globex", domain: "globex.com", evidence_confidence: "unknown" },
    // Two companies claiming one domain is a disagreement the resolver has to
    // know about, and the dry run says so instead of picking a winner.
    { company_id: "initech", domain: "globex.com", evidence_confidence: "low" },
    { company_id: "initech", domain: "globex.com", evidence_confidence: "low" }
  ];
  const evidence = [{ company_id: "acme", domain: "acme.com", evidence_type: "first_party_legal_page" }];
  const staged = stageRows({ companies, domains, evidence });

  const report = datasetReport({ companies, domains, evidence, staged });

  assert.deepEqual(report.input_rows, {
    companies: 4,
    domains: 4,
    evidence: 1,
    aliases: 0,
    relationships: 0,
    total: 9
  });
  assert.equal(report.unique_companies, 3);
  assert.equal(report.duplicate_companies, 1);
  assert.equal(report.unique_domains, 2);
  assert.equal(report.duplicate_domains, 1, "one domain is claimed by two companies");
  assert.equal(report.duplicate_domain_rows, 1, "and one row repeats a pair");
  assert.equal(report.companies_without_domains, 0);
  assert.equal(
    report.domains_without_sufficient_evidence,
    2,
    "globex.com and initech's claim on it are below the threshold with no observation; " +
      "the repeated initech row is a duplicate, not a second claim"
  );
  assert.equal(report.rejected_rows, staged.rejected.length);
  assert.equal(report.staged_rows.domains, staged.domainRows.length);
});

test("a company with no domain at all is counted, not hidden", () => {
  const companies = [
    { company_id: "acme", company_name: "Acme Ltd" },
    { company_id: "nolisting", company_name: "No Listing" }
  ];
  const domains = [{ company_id: "acme", domain: "acme.com", evidence_confidence: "unknown" }];
  const staged = stageRows({ companies, domains, evidence: [] });
  const report = datasetReport({ companies, domains, evidence: [], staged });
  assert.equal(report.companies_without_domains, 1, "only the company with no domain row is counted");
  assert.equal(report.unique_domains, 1);
  assert.equal(report.rejected_rows, 0, "a company without a domain is a legitimate row");
});

test("CSV parsing handles the quoting the generator emits", () => {
  const rows = parseCsv('company_id,company_name\nacme,"Acme, Ltd"\n"quo""ted",Globex\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].company_name, "Acme, Ltd");
  assert.equal(rows[1].company_id, 'quo"ted');
});
