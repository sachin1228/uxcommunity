#!/usr/bin/env node

/**
 * Tests for the curated MNC company-directory seed.
 *
 *   node --test scripts/generate-company-directory-mnc-seed.test.mjs
 *
 * The SQL is exercised against a real database by
 * `supabase/tests/company_directory_mnc_seed.test.sql`. What belongs here is the
 * generated file and the source list: that the migration is derived from
 * data/company-directory/mnc-companies.json rather than typed out, that the list
 * is big enough and internally consistent (unique names, domains and slugs), and
 * that the SQL contains nothing capable of destroying a member's data.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOMAIN_RE,
  loadMncCompanies,
  seedSql,
} from "./generate-company-directory-mnc-seed.mjs";
import { slugify } from "./generate-company-directory-v2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "supabase/migrations/20261007130000_company_directory_mnc_seed.sql");

const COMPANIES = loadMncCompanies();
const COMMITTED = readFileSync(OUT_PATH, "utf8");
/** The migration with its comments stripped: the static checks must see code. */
const CODE = COMMITTED.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("the committed migration is exactly what the generator produces", () => {
  assert.equal(COMMITTED, seedSql(COMPANIES));
});

test("the list is a usable directory: at least 500 companies", () => {
  assert.ok(COMPANIES.length >= 500, `expected >= 500 companies, got ${COMPANIES.length}`);
});

test("names, domains and slugs are unique and syntactically valid", () => {
  const names = new Set();
  const domains = new Set();
  const slugs = new Set();
  for (const entry of COMPANIES) {
    assert.ok(entry.name.trim().length >= 1 && entry.name.trim().length <= 120, entry.name);
    assert.match(entry.domain, DOMAIN_RE, `${entry.name}: ${entry.domain}`);
    assert.ok(!names.has(entry.name.toLowerCase()), `duplicate name ${entry.name}`);
    assert.ok(!domains.has(entry.domain), `duplicate domain ${entry.domain}`);
    assert.ok(!slugs.has(slugify(entry.name)), `duplicate slug ${slugify(entry.name)}`);
    names.add(entry.name.toLowerCase());
    domains.add(entry.domain);
    slugs.add(slugify(entry.name));
  }
});

test("no consumer mailbox domain is offered as an employer", () => {
  const consumer = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "proton.me", "mail.ru", "qq.com",
  ]);
  assert.deepEqual(
    COMPANIES.map((entry) => entry.domain).filter((domain) => consumer.has(domain)),
    []
  );
});

test("the seed never writes a proof: every hint is unverified", () => {
  assert.doesNotMatch(CODE, /verified\s*=\s*true/i);
  assert.doesNotMatch(CODE, /set\s+verified/i);
  assert.doesNotMatch(CODE, /verified_at\s*=/i);
});

test("the insert is idempotent and never overwrites an existing row", () => {
  assert.match(CODE, /on conflict \(slug\) do nothing/);
  assert.match(CODE, /on conflict \(company_id, domain\) do nothing/);
});

test("the only rows it removes are the one-character test companies", () => {
  const deletes = [...CODE.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(deletes)].sort(), ["companies"]);
  assert.match(CODE, /delete from public\.companies\s+where slug ~ '\^\[a-z0-9\]\$'/);

  assert.doesNotMatch(CODE, /\btruncate\b/i);
  assert.doesNotMatch(CODE, /\bdrop table public\./i);
  assert.doesNotMatch(CODE, /\bcascade\b/i);
  for (const table of ["company_members", "company_email_verifications", "designer_profiles", "users"]) {
    assert.doesNotMatch(CODE, new RegExp(`delete from public\\.${table}\\b`), `${table} must never be deleted`);
  }
});

test("it refuses to run before the schema it writes into exists", () => {
  assert.match(COMMITTED, /message = 'mnc_seed_needs_stewardship_schema'/);
  assert.match(COMMITTED, /apply 20260929120000_company_verified_domains\.sql/);
});

test("a name with an apostrophe survives the generator", () => {
  const sql = seedSql([{ name: "O'Brien Ltd", domain: "obrien.com", country: "GB", industry: "x" }]);
  assert.match(sql, /\('O''Brien Ltd', 'obrien\.com'/);
});

test("an unusable list is refused rather than seeded", () => {
  const dir = mkdtempSync(join(tmpdir(), "mnc-seed-"));
  const write = (name, companies) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify({ companies }));
    return path;
  };

  try {
    assert.throws(
      () => loadMncCompanies(write("bad-domain", [{ name: "Ok", domain: "not a domain" }])),
      /not a registrable domain/
    );
    assert.throws(
      () => loadMncCompanies(write("dup-name", [
        { name: "Ok", domain: "ok.com" },
        { name: "ok", domain: "ok2.com" },
      ])),
      /duplicate name/
    );
    assert.throws(
      () => loadMncCompanies(write("dup-domain", [
        { name: "Ok", domain: "ok.com" },
        { name: "Other", domain: "ok.com" },
      ])),
      /also listed for/
    );
    // Two names that slugify to one slug would collide on the companies unique
    // index, and `on conflict (slug) do nothing` would silently drop the second.
    assert.throws(
      () => loadMncCompanies(write("dup-slug", [
        { name: "Acme Inc.", domain: "acme.com" },
        { name: "Acme, Inc.", domain: "acme2.com" },
      ])),
      /collides with/
    );
    assert.throws(
      () => loadMncCompanies(write("empty", [])),
      /no `companies` array/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
