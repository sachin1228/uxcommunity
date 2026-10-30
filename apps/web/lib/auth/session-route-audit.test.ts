import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression audit for the authorization surfaces that previously trusted a
 * signature-only JWT.
 *
 * These are source-level assertions on purpose: the decisions they guard live in
 * Next route handlers and server components, whose imports (`next/headers`,
 * Supabase, React cache) make a true unit import expensive. The pure session
 * decision itself is covered by `session-validity.test.ts`; this file makes sure
 * each bypass surface actually calls that decision instead of `getRawSession` /
 * `verifySession`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "../..");
const APP_ROOT = path.join(WEB_ROOT, "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function read(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

function relative(full: string): string {
  return path.relative(WEB_ROOT, full);
}

function routeFiles(dir: string): string[] {
  return walk(dir).filter((file) => file.endsWith(`${path.sep}route.ts`));
}

test("no route outside logout reads a signature-only session", () => {
  const routes = routeFiles(path.join(APP_ROOT, "api"));
  assert.ok(routes.length > 0, "expected API routes");

  for (const file of routes) {
    const rel = relative(file);
    if (rel.endsWith("/api/auth/logout/route.ts")) continue;
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /\bgetRawSession\b|\bverifySession\b/,
      `${rel} must not treat a signature-only JWT as authorization`,
    );
  }
});

test("admin API routes require the live admin session", () => {
  const adminRoot = path.join(APP_ROOT, "api", "admin");
  const routes = routeFiles(adminRoot);
  assert.ok(routes.length > 0, "expected admin routes");

  for (const file of routes) {
    const rel = relative(file);
    // The load-test route is a thin wrapper; its implementation is checked below.
    if (rel.endsWith("/api/admin/load-test/route.ts")) continue;
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /requireSession\(\s*["']admin["']/,
      `${rel} must call requireSession("admin")`,
    );
  }

  assert.match(
    read("app/api/admin/load-test/impl.ts"),
    /requireSession\(\s*["']admin["']/,
    "admin load-test implementation must call requireSession(\"admin\")",
  );
});

test("private R2 proxies require a live session before signing", () => {
  const privateRoutes = routeFiles(path.join(APP_ROOT, "api", "private"));
  assert.equal(privateRoutes.length, 3, "expected the DM and two résumé proxies");

  for (const file of privateRoutes) {
    const rel = relative(file);
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /\b(getSession|requireSession)\(/,
      `${rel} must use a registry-backed session`,
    );
    assert.doesNotMatch(source, /\bgetRawSession\b|\bverifySession\b/, rel);
  }

  const dm = read("app/api/private/dm/[conversationId]/[file]/route.ts");
  assert.match(dm, /\bgetSession\(\)/, "DM proxy must use getSession()");
  assert.match(dm, /canViewDmAsset\(/, "DM proxy must keep the participant check");
});

test("the profile, applications and dashboard surfaces reject revoked accounts", () => {
  for (const relativePath of [
    "app/api/auth/me/route.ts",
    "app/applications/[jobId]/[applicationId]/page.tsx",
    "app/dashboard/layout.tsx",
    "app/admin/(protected)/layout.tsx",
  ]) {
    const source = read(relativePath);
    assert.match(
      source,
      /\bgetSession\(/,
      `${relativePath} must use the registry-backed getSession()`,
    );
    assert.doesNotMatch(
      source,
      /\bgetRawSession\b|\bverifySession\b/,
      `${relativePath} must not bypass the live session check`,
    );
  }
});

test("registry lookups use the token's sid, so an old token cannot resolve a fresh row", () => {
  assert.match(
    read("lib/auth/session.ts"),
    /\.eq\(\s*["']id["']\s*,\s*session\.sid\s*\)/,
    "getSession must look up the row named by the token's sid",
  );
  assert.match(
    read("app/api/internal/session/validate/route.ts"),
    /\.eq\(\s*["']id["']\s*,\s*sid\s*\)/,
    "the realtime validation route must look up the row named by the token's sid",
  );
});

test("the session helpers route every authorization through one decision", () => {
  const source = read("lib/auth/session.ts");
  assert.match(source, /export const getSession = cache\(/);
  assert.match(source, /export async function requireSession\(/);
  assert.match(
    source,
    /const context = await getSessionContext\(\)/,
    "requireSession must use getSessionContext",
  );
  assert.match(
    source,
    /return context\?\.session \?\? null/,
    "getSession must be backed by getSessionContext",
  );
  assert.match(
    source,
    /const validity = evaluateSession\(/,
    "validateSessionPayload must use the shared evaluator",
  );
});
