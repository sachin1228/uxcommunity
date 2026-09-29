#!/usr/bin/env node

/**
 * Resets the company directory: removes the v1 seed's 4,574 companies from a
 * database that already ran that migration, and nothing else.
 *
 *   PGHOST=… PGDATABASE=… PGUSER=… \
 *     node scripts/reset-company-directory-seed.mjs              # dry run, no writes
 *   PGHOST=… PGDATABASE=… PGUSER=… \
 *     node scripts/reset-company-directory-seed.mjs --apply      # the removal
 *
 *   flags:  --apply           delete the disposable seed rows (default: plan only)
 *           --keep-retained   proceed even while a seeded company is referenced
 *                             by application data (removes only the disposable
 *                             rows; the referenced ones are kept and reported)
 *           --sql <path>      use another copy of the operation SQL
 *           --report <file>   also write the JSON report here
 *
 * WHY A SCRIPT AND NOT A MIGRATION
 *   The v1 seed migration itself is gone from the repository, so a database
 *   built from this repository creates an EMPTY company directory and needs no
 *   reset at all. Only a database that already applied the seed holds the rows —
 *   production does — and a production row deletion is not something that should
 *   happen as a side effect of `db push`. This is the explicit operation, and its
 *   default mode writes nothing.
 *
 * WHAT IT DELETES, AND WHAT IT WILL NOT
 *   `supabase/reset/company_directory_seed_reset.sql` (generated) plans the
 *   removal: a company is removable only if its slug is in the seed's own list
 *   AND no application data references it. A seeded company that a member has
 *   joined, a proof names, a profile points at, an operator reviewed, a
 *   delegation names, an observation describes, or another layer owns is KEPT
 *   and reported. While one of those exists, `--apply` refuses to run unless
 *   `--keep-retained` is passed, and then it removes only the disposable rows.
 *
 * WHAT IT CHECKS BEFORE AND AFTER
 *   * every foreign key that points at `companies` is in the guard list below.
 *     A new table that references companies is an UNEXPECTED DEPENDENCY, and
 *     `--apply` stops rather than delete rows it did not account for;
 *   * the set of verified domains is snapshotted before the removal and compared
 *     after it: a directory reset may never un-verify a domain or move one;
 *   * no claim is left pointing at a company that no longer exists.
 *
 *   Nothing here reads or writes the rest of the application.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SQL = join(ROOT, "supabase/reset/company_directory_seed_reset.sql");

/**
 * Every table with a foreign key to `public.companies`, in the order the reset
 * SQL guards them. Anything else in the live database is a dependency this
 * operation has not accounted for, and it says so instead of assuming.
 */
const GUARDED_TABLES = [
  "company_aliases",
  "company_domain_delegations",
  "company_domain_reviews",
  "company_domains",
  "company_email_verifications",
  "company_members",
  "company_relationships",
  "designer_profiles",
  "domain_evidence"
];

const PSQL = ["psql", "--quiet", "--no-psqlrc", "--no-align", "--tuples-only", "-v", "ON_ERROR_STOP=1"];

function psql(sql, { label, allowFailure = false } = {}) {
  const result = spawnSync(PSQL[0], PSQL.slice(1), {
    input: sql,
    encoding: "utf8",
    env: process.env
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed:\n${detail}`);
  }
  return { stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim(), status: result.status };
}

/** One JSON value, so the report never depends on psql's table formatting. */
function json(sql, options) {
  const out = psql(sql, options).stdout;
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`${options?.label ?? "query"} did not return JSON:\n${out}`);
  }
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const PLAN_SQL = `
select json_build_object(
  'record',            (select count(*) from public.company_directory_seed_retired),
  'present',           (select count(*) from public.company_directory_seed_retirement_plan()),
  'removable',         (select count(*) from public.company_directory_seed_retirement_plan() where disposable),
  'retained',          (select count(*) from public.company_directory_seed_retirement_plan() where not disposable),
  'unexplained',       (select count(*) from public.company_directory_seed_retirement_plan()
                         where not disposable and reason is null),
  'companies',         (select count(*) from public.companies),
  'claims',            (select count(*) from public.company_domains),
  'verified_claims',   (select count(*) from public.company_domains where verified),
  'fk_tables',         (select coalesce(json_agg(distinct conrelid::regclass::text), '[]'::json)
                          from pg_constraint
                         where contype = 'f' and confrelid = 'public.companies'::regclass),
  'would_remove',      (select json_build_object(
                          'claims',        coalesce(sum(claims), 0),
                          'observations',  coalesce(sum(observations), 0),
                          'aliases',       coalesce(sum(aliases), 0),
                          'relationships', coalesce(sum(relationships), 0),
                          'reviews',       coalesce(sum(reviews), 0),
                          'delegations',   coalesce(sum(delegations), 0))
                         from public.company_directory_seed_retirement_plan() where disposable),
  'retained_rows',     (select coalesce(json_agg(json_build_object(
                          'slug', slug, 'name', name, 'domain', domain, 'reason', reason,
                          'members', members, 'verifications', verifications,
                          'profile_pointers', profile_pointers, 'verified_claims', verified_claims,
                          'observations', observations, 'reviews', reviews, 'delegations', delegations)
                          order by slug), '[]'::json)
                         from public.company_directory_seed_retirement_plan() where not disposable),
  'verified_snapshot', (select coalesce(json_agg(json_build_object(
                          'company_id', company_id, 'domain', domain) order by domain), '[]'::json)
                         from public.company_domains where verified)
)::text;
`;

const POST_SQL = `
select json_build_object(
  'companies',         (select count(*) from public.companies),
  'claims',            (select count(*) from public.company_domains),
  'verified_claims',   (select count(*) from public.company_domains where verified),
  'verified_snapshot', (select coalesce(json_agg(json_build_object(
                          'company_id', company_id, 'domain', domain) order by domain), '[]'::json)
                         from public.company_domains where verified),
  'orphan_claims',     (select count(*) from public.company_domains as cd
                         where not exists (select 1 from public.companies as c where c.id = cd.company_id)),
  'members',           (select count(*) from public.company_members),
  'verifications',     (select count(*) from public.company_email_verifications),
  'profile_pointers',  (select count(*) from public.designer_profiles where company_id is not null)
)::text;
`;

function unchanged(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function main() {
  const apply = process.argv.includes("--apply");
  const keepRetained = process.argv.includes("--keep-retained");
  const sqlPath = flag("--sql") ?? DEFAULT_SQL;

  // 1. The operation's own objects (record table, plan function, retained view).
  //    This is DDL plus the seed's own list; it deletes nothing. Idempotent, so
  //    a dry run and an apply can be run back to back, and re-run later.
  psql(readFileSync(sqlPath, "utf8"), { label: `applying ${sqlPath.replace(`${ROOT}/`, "")}` });

  // 2. The plan. Read-only.
  const plan = json(PLAN_SQL, { label: "planning the reset" });

  const unexpected = plan.fk_tables.filter((table) => !GUARDED_TABLES.includes(table));
  const missing = GUARDED_TABLES.filter((table) => !plan.fk_tables.includes(table));

  console.log(`company-directory reset — ${apply ? "APPLY" : "dry run"}\n`);
  console.log(`  seeded companies recorded        ${plan.record}`);
  console.log(`  still present in this database   ${plan.present}`);
  console.log(`  would be removed                 ${plan.removable}`);
  console.log(`  retained (application data)      ${plan.retained}`);
  console.log(`  companies / claims before        ${plan.companies} / ${plan.claims}`);
  console.log(
    `  would go with them               claims ${plan.would_remove.claims}, ` +
      `evidence ${plan.would_remove.observations}, aliases ${plan.would_remove.aliases}, ` +
      `relationships ${plan.would_remove.relationships}, reviews ${plan.would_remove.reviews}, ` +
      `delegations ${plan.would_remove.delegations}`
  );

  if (unexpected.length > 0) {
    console.log(`\n  UNEXPECTED DEPENDENCY: ${unexpected.join(", ")} reference(s) companies and is not guarded.`);
  }
  if (missing.length > 0) {
    console.log(`\n  note: ${missing.join(", ")} do(es) not exist in this database yet.`);
  }

  if (plan.retained > 0) {
    console.log(`\n  retained rows (a person or an operator has touched these, so the reset keeps them):`);
    for (const row of plan.retained_rows) {
      const detail = Object.entries(row)
        .filter(([key, value]) => typeof value === "number" && value > 0)
        .map(([key, value]) => `${key} ${value}`)
        .join(", ");
      console.log(`    ${row.slug}  ${row.domain}  ${row.reason ?? "UNEXPLAINED"}${detail ? `  (${detail})` : ""}`);
    }
  }

  const report = { mode: apply ? "apply" : "plan", plan };

  if (!apply) {
    console.log("\n  nothing was deleted (dry run). Re-run with --apply to remove the disposable rows.");
    finish(report);
    return;
  }

  // 3. The gates. Both are refusals, not warnings: a directory reset must not
  //    quietly delete rows it did not account for, and must not bury the rows it
  //    kept inside a successful-looking run.
  if (unexpected.length > 0) {
    console.log(
      `\n  refusing to apply: ${unexpected.join(", ")} reference(s) companies and no guard accounts ` +
        "for them. Add them to the reset's guards (and to GUARDED_TABLES here) first."
    );
    report.refused = "unexpected_dependency";
    writeReport(report);
    process.exitCode = 1;
    return;
  }
  if (plan.retained > 0 && !keepRetained) {
    console.log(
      `\n  refusing to apply: ${plan.retained} seeded compan${plan.retained === 1 ? "y is" : "ies are"} ` +
        "referenced by application data. Review the rows above, then re-run with --keep-retained to " +
        "remove only the disposable rows (the referenced ones stay)."
    );
    report.refused = "retained_rows";
    writeReport(report);
    process.exitCode = 1;
    return;
  }
  if (plan.unexplained > 0) {
    console.log(`\n  refusing to apply: ${plan.unexplained} retained row(s) have no recorded reason.`);
    report.refused = "unexplained_retention";
    writeReport(report);
    process.exitCode = 1;
    return;
  }

  // 4. The removal.
  const counts = json(
    `select row_to_json(d)::text from public.retire_company_directory_seed(false, ${keepRetained}) as d;`,
    { label: "removing the disposable seed rows" }
  );
  report.removed = counts;

  console.log(
    `\n  removed                          companies ${counts.companies_removed}, ` +
      `claims ${counts.claims_removed}, dependent rows ${counts.dependents_removed}`
  );

  // 5. Afterwards: what must not have changed.
  const after = json(POST_SQL, { label: "verifying the result" });
  report.after = after;

  const verifiedIntact = unchanged(plan.verified_snapshot, after.verified_snapshot);
  console.log(`  companies / claims after         ${after.companies} / ${after.claims}`);
  console.log(`  verified domains                 ${after.verified_claims} (before ${plan.verified_claims})`);
  console.log(`  members / verifications / profiles kept  ${after.members} / ${after.verifications} / ${after.profile_pointers}`);
  console.log(`  orphaned claims                  ${after.orphan_claims}`);

  if (!verifiedIntact) {
    console.log("\n  THE VERIFIED SET CHANGED. That must never happen in a directory reset; investigate.");
    report.problem = "verified_set_changed";
    writeReport(report);
    process.exitCode = 1;
    return;
  }
  if (after.orphan_claims > 0) {
    console.log("\n  ORPHANED CLAIMS. The removal left claims with no company; investigate.");
    report.problem = "orphaned_claims";
    writeReport(report);
    process.exitCode = 1;
    return;
  }

  console.log("\n  done: the seed's disposable rows are gone and nothing else moved.");
  finish(report);
}

function writeReport(report) {
  const path = flag("--report");
  if (path) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function finish(report) {
  writeReport(report);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
