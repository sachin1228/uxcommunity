import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guards for the moderation system's non-negotiable rules.
 *
 * These are source-level assertions, like `session-route-audit.test.ts`: the
 * behavior they protect lives in route handlers, SQL migrations and the action
 * engine, which are expensive to import in a unit test. The pure decisions
 * (reason sets, allowed actions, appeal eligibility, suspension) are covered by
 * their own suites.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

function readWeb(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function readRepo(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

test("report creation is authorized by a live user session", () => {
  for (const route of [
    "app/api/interaction-reports/route.ts",
    "app/api/content-reports/route.ts",
  ]) {
    assert.match(
      readWeb(route),
      /requireSession\(\s*["']user["']/,
      `${route} must require a user session`,
    );
  }
});

test("every moderation action route requires the live admin session", () => {
  for (const route of [
    "app/api/admin/interaction-reports/route.ts",
    "app/api/admin/interaction-reports/[id]/route.ts",
    "app/api/admin/moderation/audit/route.ts",
    "app/api/admin/moderation-appeals/route.ts",
    "app/api/admin/moderation-appeals/[id]/route.ts",
  ]) {
    assert.match(
      readWeb(route),
      /requireSession\(\s*["']admin["']/,
      `${route} must require an admin session`,
    );
  }
});

test("report documents carry their own evidence snapshot", () => {
  const route = readWeb("app/api/interaction-reports/route.ts");
  assert.match(route, /target_snapshot:\s*target\.snapshot/);
  assert.match(
    readWeb("lib/moderation/interaction-reports.ts"),
    /snapshot:\s*\{[\s\S]*name:\s*community\.name[\s\S]*owner_name:/,
    "community reports must snapshot name, description and owner",
  );
  assert.match(
    readWeb("lib/moderation/interaction-reports.ts"),
    /snapshot:\s*\{[\s\S]*company_name:[\s\S]*description:\s*job\.description/,
    "job reports must snapshot company and description",
  );
});

test("moderation never deletes job applications or hits the applications table", () => {
  const engine = readWeb("lib/moderation/resolve-report.ts");
  assert.doesNotMatch(
    engine,
    /job_applications/,
    "the moderation engine must not touch job applications",
  );
  assert.doesNotMatch(
    engine,
    /from\(["']job_posts["']\)[\s\S]{0,200}\.delete\(/,
    "moderation must close a job, never delete it",
  );
  assert.match(engine, /status:\s*["']closed["']/, "a moderated job is closed");
  assert.match(engine, /moderated_at/, "a moderated job is flagged");
});

test("a community is hidden, not deleted, and membership is untouched", () => {
  const engine = readWeb("lib/moderation/resolve-report.ts");
  assert.match(engine, /is_active:\s*false/);
  assert.doesNotMatch(
    engine,
    /community_members/,
    "hiding a community must not touch memberships",
  );
  assert.doesNotMatch(
    engine,
    /from\(["']communities["']\)[\s\S]{0,160}\.delete\(/,
    "moderation must hide a community, never delete it",
  );
});

test("the audit log is append-only in the migration", () => {
  const migration = readRepo(
    "supabase/migrations/20261030220000_complete_moderation_system.sql",
  );
  assert.match(migration, /moderation_audit_log_immutable/);
  assert.match(migration, /before update or delete on public\.moderation_audit_log/);
  assert.match(migration, /grant select, insert on public\.moderation_audit_log to service_role/);
  assert.doesNotMatch(
    migration,
    /grant[^;]*update[^;]*on public\.moderation_audit_log/i,
    "the audit table must not grant UPDATE",
  );
});

test("the reporter identity is never put on the affected member's notice", () => {
  const engine = readWeb("lib/moderation/resolve-report.ts");
  const subjectNotice = engine.slice(
    engine.indexOf("if (subjectNotice && report.target_author_id)"),
  );
  assert.ok(subjectNotice.length > 0, "expected the subject notification block");
  assert.doesNotMatch(
    subjectNotice,
    /reporter_id|reporter_name|reporter\.name/,
    "the affected member's notification must not reference the reporter",
  );
  assert.match(subjectNotice, /actorId:\s*null/);
});

test("appeals are one-per-report at the database level and rate limited in the API", () => {
  const migration = readRepo(
    "supabase/migrations/20261030220000_complete_moderation_system.sql",
  );
  assert.match(migration, /moderation_appeals_report_unique/);
  const route = readWeb("app/api/moderation/appeals/route.ts");
  assert.match(route, /rateLimit\(`moderation-appeal:/);
  assert.match(route, /APPEAL_DAILY_LIMIT/);
  assert.match(route, /validateAppeal\(/);
});

test("temporary suspension is enforced by the session evaluator", () => {
  const validity = readWeb("lib/auth/session-validity.ts");
  assert.match(validity, /suspended_until/);
  assert.match(validity, /isSuspendedAccount\(user\.suspended_until, now\)/);
  const session = readWeb("lib/auth/session.ts");
  assert.match(session, /users!auth_sessions_user_id_fkey\(id, is_blocked, suspended_until/);
  const migration = readRepo(
    "supabase/migrations/20261030220000_complete_moderation_system.sql",
  );
  assert.match(migration, /set_user_suspended/);
});
