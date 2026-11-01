#!/usr/bin/env node

/**
 * Tests for the realtime smoke test's own plumbing.
 *
 *   node --test scripts/smoke-realtime.test.mjs
 *
 * The checks themselves need a deployed Worker (that is the point of the
 * script), but the pieces that decide WHICH origin to probe, WHICH secrets to
 * sign with and WHAT claims the token carries run in CI on every deploy — and a
 * mistake there would either probe the wrong host or fail a healthy Worker. So
 * they are pinned down here, including the one that matters most: the token this
 * script mints has to be one the Worker's `verifyJwt` accepts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { jwtVerify } from "jose";

import {
  validateSmokeEnvironment,
  buildSmokeToken,
  classifyMembershipProbe,
  membershipProbeUrl,
  parseDevVars,
  parseFrame,
  provisionSmokeSession,
  releaseSmokeSession,
  resolveMembershipConfig,
  resolveSecrets,
  resolveSupabaseConfig,
  SENTINEL_COMMUNITY_ID,
  SENTINEL_USER_ID,
  smokeSessionRow,
  smokeUserRow,
  toWebSocketOrigin,
  TOKEN_TTL_SECONDS,
} from "./smoke-realtime.mjs";

// ── Origin normalization ────────────────────────────────────────────────────

test("an https origin becomes wss, an http origin becomes ws", () => {
  assert.equal(toWebSocketOrigin("https://rt.uxcommunity.in"), "wss://rt.uxcommunity.in");
  assert.equal(toWebSocketOrigin("http://localhost:8787"), "ws://localhost:8787");
  assert.equal(toWebSocketOrigin("http://127.0.0.1:8787/"), "ws://127.0.0.1:8787");
});

test("a trailing slash or whitespace does not produce a double slash in the upgrade URL", () => {
  assert.equal(toWebSocketOrigin("  https://rt.uxcommunity.in///  "), "wss://rt.uxcommunity.in");
});

test("anything that is not an http(s) origin is refused rather than probed", () => {
  for (const value of ["", "   ", "rt.uxcommunity.in", "ftp://example.com", "wss://rt.uxcommunity.in", null, undefined]) {
    assert.equal(toWebSocketOrigin(value), null, `${JSON.stringify(value)} must not pass`);
  }
});

// ── Secret resolution ───────────────────────────────────────────────────────

test("dev vars are parsed with quotes, comments and blank lines handled", () => {
  const vars = parseDevVars(
    ['# comment', '', 'SESSION_SECRET="abc123"', "REALTIME_PUBLISH_SECRET='def456'", "API_URL=http://localhost:3000"].join("\n"),
  );
  assert.deepEqual(vars, {
    SESSION_SECRET: "abc123",
    REALTIME_PUBLISH_SECRET: "def456",
    API_URL: "http://localhost:3000",
  });
});

test("the environment wins over dev vars, so CI tests the deployed secrets", () => {
  const resolved = resolveSecrets(
    { SESSION_SECRET: "from-env", REALTIME_PUBLISH_SECRET: "publish-env" },
    { SESSION_SECRET: "from-file", REALTIME_PUBLISH_SECRET: "publish-file" },
  );
  assert.equal(resolved.sessionSecret, "from-env");
  assert.equal(resolved.publishSecret, "publish-env");
  assert.deepEqual(resolved.missing, []);
  assert.equal(resolved.source, "environment");
});

test("dev vars fill in for a local run", () => {
  const resolved = resolveSecrets({}, { SESSION_SECRET: "file-session", REALTIME_PUBLISH_SECRET: "file-publish" });
  assert.equal(resolved.sessionSecret, "file-session");
  assert.equal(resolved.publishSecret, "file-publish");
  assert.deepEqual(resolved.missing, []);
});

test("missing secrets are reported by name, never by value", () => {
  const resolved = resolveSecrets({ SESSION_SECRET: "present" }, null);
  assert.deepEqual(resolved.missing, ["REALTIME_PUBLISH_SECRET"]);
  const empty = resolveSecrets({}, {});
  assert.deepEqual(empty.missing, ["SESSION_SECRET", "REALTIME_PUBLISH_SECRET"]);
});

// ── The membership endpoint community sockets are authorized against ────────

test("the membership check reads the same API_URL/API_SECRET pair the Worker gets", () => {
  const fromEnv = resolveMembershipConfig(
    { API_URL: "https://app.uxcommunity.in", API_SECRET: "app-secret" },
    { API_URL: "http://localhost:3000", API_SECRET: "dev-secret" },
  );
  assert.deepEqual(fromEnv, { apiUrl: "https://app.uxcommunity.in", apiSecret: "app-secret", missing: [] });

  // A local run with no membership API configured SKIPS the check, so an
  // absent pair is reported by name rather than turned into a failure.
  const absent = resolveMembershipConfig({}, { API_SECRET: "dev-secret" });
  assert.deepEqual(absent.missing, ["API_URL"]);
  assert.deepEqual(resolveMembershipConfig({}, null).missing, ["API_URL", "API_SECRET"]);
});

test("the probe URL is the Worker's own membership URL, trailing slash and all", () => {
  assert.equal(
    membershipProbeUrl("https://app.uxcommunity.in/"),
    `https://app.uxcommunity.in/api/communities/${SENTINEL_COMMUNITY_ID}/members/${SENTINEL_USER_ID}/check`,
  );
  for (const value of ["", "   ", "app.uxcommunity.in", "ftp://example.com", null, undefined]) {
    assert.equal(membershipProbeUrl(value), null, `${JSON.stringify(value)} must not produce a probe`);
  }
});

test("the app's own two answers pass the check", () => {
  const member = classifyMembershipProbe({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  assert.equal(member.ok, true);

  const nonMember = classifyMembershipProbe({
    status: 403,
    contentType: "application/json; charset=utf-8",
    body: '{"ok":false}',
  });
  assert.equal(nonMember.ok, true);
});

test("a mismatched API_SECRET fails with the secret to fix", () => {
  const verdict = classifyMembershipProbe({
    status: 401,
    contentType: "application/json",
    body: '{"ok":false,"error":"unauthorized"}',
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /API_SECRET/);
});

test("an API_URL that is not the app fails with the secret to fix", () => {
  // What a stale deployment answers: the old Vercel host 404s the route, and a
  // sibling Worker (rt.uxcommunity.in) answers plain "Not found".
  const vercel = classifyMembershipProbe({
    status: 404,
    contentType: "text/html; charset=utf-8",
    body: "<!DOCTYPE html><html>…</html>",
  });
  assert.equal(vercel.ok, false);
  assert.match(vercel.message, /API_URL/);

  const worker = classifyMembershipProbe({ status: 404, contentType: "text/plain", body: "Not found" });
  assert.equal(worker.ok, false);
  assert.match(worker.message, /API_URL/);

  // A 403 that is not the app's shape (a WAF page, another app's refusal) must
  // not be mistaken for the app's non-member answer.
  const notTheApp = classifyMembershipProbe({ status: 403, contentType: "text/html", body: "<html>blocked</html>" });
  assert.equal(notTheApp.ok, false);
});

test("the web app's own misconfiguration is reported, not swallowed", () => {
  const noSecret = classifyMembershipProbe({
    status: 500,
    contentType: "application/json",
    body: '{"ok":false,"error":"API_SECRET not configured"}',
  });
  assert.equal(noSecret.ok, false);
  assert.match(noSecret.message, /API_SECRET not configured/);

  const unexpected = classifyMembershipProbe({ status: 200, contentType: "application/json", body: '{"ok":false}' });
  assert.equal(unexpected.ok, false);
});

// ── The token the Worker must accept ────────────────────────────────────────

test("the minted token verifies against the same secret and carries the registry claims", async () => {
  const secret = "smoke-secret-value";
  const token = await buildSmokeToken(secret, { sid: "session-id", sv: 1 });

  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  assert.equal(payload.userId, SENTINEL_USER_ID);
  assert.equal(payload.role, "user");
  assert.equal(payload.sid, "session-id");
  assert.equal(payload.sv, 1);

  // The Worker drops the socket when `payload.userId` is absent (handleUpgrade),
  // so a token without it would look like an auth failure in production.
  assert.ok(typeof payload.userId === "string" && payload.userId.length > 0);
  assert.ok(typeof payload.exp === "number" && payload.exp - payload.iat === TOKEN_TTL_SECONDS);

  await assert.rejects(() => jwtVerify(token, new TextEncoder().encode("a-different-secret")));
});

test("a token cannot be minted without the live session the Worker demands", async () => {
  for (const session of [undefined, null, {}, { sid: "sid" }, { sv: 1 }]) {
    await assert.rejects(
      () => buildSmokeToken("secret", session),
      /live session/,
      `${JSON.stringify(session)} must not mint a token`,
    );
  }
});

// ── The disposable session the authenticated checks borrow ─────────────────

test("the service-role pair resolves from the environment, then local files", () => {
  const fromEnv = resolveSupabaseConfig(
    { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "key" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://file.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "file-key" },
  );
  assert.deepEqual(fromEnv, {
    url: "https://project.supabase.co",
    serviceKey: "key",
    missing: [],
  });

  const fromFiles = resolveSupabaseConfig({}, {
    SUPABASE_URL: "https://file.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "file-key",
  });
  assert.equal(fromFiles.url, "https://file.supabase.co");
  assert.equal(fromFiles.serviceKey, "file-key");
  assert.deepEqual(resolveSupabaseConfig({}, null).missing, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
});

test("the fixture rows are the shape the registry validates", () => {
  const user = smokeUserRow();
  assert.equal(user.id, SENTINEL_USER_ID);
  assert.equal(user.is_blocked, false);
  assert.equal(user.session_version, 1);

  const session = smokeSessionRow(1_000);
  assert.equal(session.user_id, SENTINEL_USER_ID);
  assert.equal(session.role, "user");
  assert.equal(session.session_version, 1);
  assert.ok(Date.parse(session.expires_at) > 1_000);
});

test("provisioning upserts the user, clears strays and returns the new session", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/rest/v1/auth_sessions") && init.method === "POST") {
      return new Response(JSON.stringify([{ id: "new-session" }]), { status: 201 });
    }
    return new Response(null, { status: 204 });
  };

  const session = await provisionSmokeSession(
    { url: "https://project.supabase.co", serviceKey: "service" },
    { fetchImpl },
  );
  assert.deepEqual(session, { sid: "new-session", sv: 1 });

  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/rest\/v1\/users\?on_conflict=id$/);
  assert.equal(calls[0].init.headers.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.match(calls[1].url, /\/rest\/v1\/auth_sessions\?user_id=eq\./);
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[2].init.headers.Prefer, "return=representation");
  assert.equal(calls[2].init.headers.Authorization, "Bearer service");
});

test("release removes the session and the user, and reports failures", async () => {
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const none = await releaseSmokeSession(
    { url: "https://project.supabase.co", serviceKey: "service" },
    { sid: "s1" },
    { fetchImpl: okFetch },
  );
  assert.deepEqual(none, []);
  assert.match(calls[0].url, /auth_sessions\?id=eq\.s1$/);
  assert.match(calls[1].url, /users\?id=eq\./);

  const failingFetch = async () => new Response("nope", { status: 500 });
  const failures = await releaseSmokeSession(
    { url: "https://project.supabase.co", serviceKey: "service" },
    { sid: "s1" },
    { fetchImpl: failingFetch },
  );
  assert.equal(failures.length, 2);
  assert.match(failures[0], /smoke session/);
  assert.match(failures[1], /smoke user/);
});

// ── Frame parsing ───────────────────────────────────────────────────────────

test("frame parsing ignores non-JSON and non-object frames instead of throwing", () => {
  assert.deepEqual(parseFrame('{"t":"hello"}'), { t: "hello" });
  assert.equal(parseFrame("pong"), null);
  assert.equal(parseFrame("{not json"), null);
  assert.equal(parseFrame("null"), null);
  assert.equal(parseFrame("[1,2,3]"), null);
});


test("smoke session writes reject mixed environments and require production release approval", () => {
  assert.throws(() => validateSmokeEnvironment({}, ["http://localhost"]));
  assert.throws(() => validateSmokeEnvironment({APP_ENV:"development"}, ["https://eauupthwlnarkauwifmw.supabase.co"]));
  assert.throws(() => validateSmokeEnvironment({APP_ENV:"staging",STAGING_ALLOWED_ORIGINS:"https://app.uxcommunity.in"}, ["https://app.uxcommunity.in"]));
  assert.throws(() => validateSmokeEnvironment({APP_ENV:"production"}, ["https://rt.uxcommunity.in"]));
  assert.doesNotThrow(() => validateSmokeEnvironment({APP_ENV:"development"}, ["http://localhost:3000","http://127.0.0.1:54321"]));
  const sha="a".repeat(40);
  assert.doesNotThrow(() => validateSmokeEnvironment({APP_ENV:"production",GITHUB_ACTIONS:"true",GITHUB_SHA:sha,APPROVED_PRODUCTION_SMOKE_SHA:sha}, ["https://rt.uxcommunity.in"]));
});
