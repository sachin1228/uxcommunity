#!/usr/bin/env node

/**
 * Tests for the service-credential preflight guard.
 *
 *   node --test scripts/verify-service-credentials.test.mjs
 *
 * This guard fails a deploy, so every branch that can turn a run red is pinned
 * here: a healthy credential passes, a rejected one is reported with the
 * repository secret to rotate, and the two levels behave as designed — Supabase
 * and Resend block a deploy, Upstash and GIPHY only warn, because the app keeps
 * serving without them (the limiter fails open by design). It also pins the two
 * ways the guard could do harm: probing the wrong endpoint, and leaking a
 * credential into a log.
 *
 * Nothing here needs the network or a provider account: `fetch` is injected.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkServiceCredentials,
  classifyProbe,
  loadServiceEnv,
  probeRequest,
  SERVICES,
} from "./verify-service-credentials.mjs";

const SUPABASE_KEY = "sb-service-role-value-that-must-never-be-logged";
const RESEND_KEY = "re-resend-value-that-must-never-be-logged";
const UPSTASH_TOKEN = "upstash-token-that-must-never-be-logged";
const GIPHY_KEY = "giphy-key-that-must-never-be-logged";
const SUPABASE_URL = "https://project-ref.supabase.co";

/** A fetch stub that answers each URL by the predicate it matches. */
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const route = routes.find((candidate) => candidate.match(String(url)));
    if (!route) throw new Error(`unexpected request: ${url}`);
    if (route.networkError) throw new Error("socket hang up");
    return {
      status: route.status ?? 200,
      text: async () => route.body ?? "",
    };
  };
  return { fetchImpl, calls };
}

/** The four probes, each healthy by default. */
const HEALTHY_ROUTES = [
  { match: (url) => url.startsWith(SUPABASE_URL), status: 200 },
  { match: (url) => url.includes("api.resend.com"), status: 200 },
  { match: (url) => url.includes("upstash.io"), status: 200, body: "PONG" },
  { match: (url) => url.includes("api.giphy.com"), status: 200 },
];

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
  RESEND_API_KEY: RESEND_KEY,
  UPSTASH_REDIS_REST_URL: "https://named-instance.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: UPSTASH_TOKEN,
  GIPHY_API_KEY: GIPHY_KEY,
};

/** Runs the check with everything healthy unless a route overrides it. */
async function run(env = ENV, routes = HEALTHY_ROUTES) {
  const { fetchImpl, calls } = stubFetch(routes);
  const result = await checkServiceCredentials({ env, fetchImpl, files: [] });
  return { ...result, calls };
}

const textOf = (result) => result.lines.map((line) => line.text).join("\n");
const lineFor = (result, label) => result.lines.find((line) => line.text.startsWith(label));

test("a healthy set of credentials passes and every service is reported", async () => {
  const result = await run();

  assert.equal(result.exitCode, 0);
  assert.equal(result.ok, true);
  assert.ok(result.lines.every((line) => line.level === "ok"));
  for (const service of SERVICES) {
    assert.ok(lineFor(result, service.label), `missing a line for ${service.label}`);
  }
});

test("no credential value ever reaches the output", async () => {
  const healthy = await run();
  const rejected = await run(ENV, [
    { match: (url) => url.startsWith(SUPABASE_URL), status: 401 },
    { match: (url) => url.includes("api.resend.com"), status: 401 },
    { match: (url) => url.includes("upstash.io"), status: 401, body: SUPABASE_KEY },
    { match: (url) => url.includes("api.giphy.com"), status: 401, body: RESEND_KEY },
  ]);

  const output = textOf(healthy) + textOf(rejected);
  for (const secret of [SUPABASE_KEY, RESEND_KEY, UPSTASH_TOKEN, GIPHY_KEY]) {
    assert.ok(!output.includes(secret), `output leaked ${secret.slice(0, 6)}…`);
  }
  // A masked fingerprint is still useful when two candidate keys disagree.
  assert.ok(output.includes("sb-s…ged"), "expected the Supabase key fingerprint in the report");
});

test("a rejected Supabase service-role key fails the deploy and names the secret", async () => {
  const result = await run(ENV, [
    { match: (url) => url.startsWith(SUPABASE_URL), status: 401 },
    { match: (url) => true, status: 200 },
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.ok, false);
  const line = lineFor(result, "Supabase (service-role key)");
  assert.equal(line?.level, "fail");
  assert.match(line.text, /SUPABASE_SERVICE_ROLE_KEY was rejected/);
  assert.match(line.text, /HTTP 401/);
});

test("a rejected Resend key fails: resets would silently stop arriving", async () => {
  const result = await run(ENV, [
    { match: (url) => url.includes("api.resend.com"), status: 403 },
    { match: (url) => true, status: 200 },
  ]);

  assert.equal(result.exitCode, 1);
  const line = lineFor(result, "Resend (transactional email)");
  assert.equal(line?.level, "fail");
  assert.match(line.text, /password resets and invitations stop arriving/);
});

// Verified against the live API on 2026-10-09: Resend answers a dead key with
// 400 and {"message":"API key is invalid"}, never 401. Reading only the status
// code would report this as a wrong URL and let the deploy through.
test("Resend's 400 'API key is invalid' is a rejection, not a wrong URL", async () => {
  const result = await run(ENV, [
    {
      match: (url) => url.includes("api.resend.com"),
      status: 400,
      body: '{"statusCode":400,"message":"API key is invalid","name":"validation_error"}',
    },
    { match: (url) => true, status: 200 },
  ]);

  assert.equal(result.exitCode, 1, "a dead Resend key must block the deploy");
  const line = lineFor(result, "Resend (transactional email)");
  assert.equal(line?.level, "fail");
  assert.match(line.text, /RESEND_API_KEY was rejected/);

  const other = await run(ENV, [
    { match: (url) => url.includes("api.resend.com"), status: 400, body: '{"message":"invalid domain"}' },
    { match: (url) => true, status: 200 },
  ]);
  assert.match(textOf(other), /check the URL\/account for RESEND_API_KEY/);
});

test("a dead Upstash token only warns, because the limiter fails open", async () => {
  const result = await run(ENV, [
    { match: (url) => url.includes("upstash.io"), status: 401 },
    { match: (url) => true, status: 200 },
  ]);

  assert.equal(result.exitCode, 0, "rate limiting must not block the app's deploy");
  const line = lineFor(result, "Upstash Redis (rate limiting)");
  assert.equal(line?.level, "warn");
  assert.match(line.text, /every rate limit is silently off/);
});

test("a dead GIPHY key only warns", async () => {
  const result = await run(ENV, [
    { match: (url) => url.includes("api.giphy.com"), status: 401 },
    { match: (url) => true, status: 200 },
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(lineFor(result, "GIPHY (GIF search)")?.level, "warn");
});

test("a missing Supabase key fails before any request is made to it", async () => {
  const env = { ...ENV };
  delete env.SUPABASE_SERVICE_ROLE_KEY;

  const result = await run(env, [
    { match: (url) => url.startsWith(SUPABASE_URL), status: 200 },
    { match: (url) => true, status: 200 },
  ]);

  assert.equal(result.exitCode, 1);
  const line = lineFor(result, "Supabase (service-role key)");
  assert.equal(line?.level, "fail");
  assert.match(line.text, /SUPABASE_SERVICE_ROLE_KEY is not set/);
  assert.ok(
    !result.calls.some((call) => call.url.startsWith(SUPABASE_URL)),
    "an unset credential must not be probed with an empty value",
  );
});

test("missing Upstash and GIPHY values only warn", async () => {
  const env = { ...ENV };
  delete env.UPSTASH_REDIS_REST_TOKEN;
  delete env.GIPHY_API_KEY;

  const result = await run(env);

  assert.equal(result.exitCode, 0);
  assert.equal(lineFor(result, "Upstash Redis (rate limiting)")?.level, "warn");
  assert.equal(lineFor(result, "GIPHY (GIF search)")?.level, "warn");
});

test("a provider 5xx or a network failure warns instead of blocking the deploy", async () => {
  const fiveHundred = await run(ENV, [{ match: () => true, status: 503 }]);
  assert.equal(fiveHundred.exitCode, 0);
  assert.ok(fiveHundred.lines.every((line) => line.level === "warn"));

  const offline = await run(ENV, [{ match: () => true, networkError: true }]);
  assert.equal(offline.exitCode, 0);
  assert.match(textOf(offline), /could not be verified \(HTTP no response\)/);
});

test("each probe targets the endpoint that proves the credential without side effects", () => {
  const supabase = probeRequest(SERVICES.find((s) => s.id === "supabase"), ENV);
  assert.equal(supabase.url, `${SUPABASE_URL}/rest/v1/users?select=id&limit=1`);
  assert.equal(supabase.init.headers.apikey, SUPABASE_KEY);
  assert.equal(supabase.init.headers.Authorization, `Bearer ${SUPABASE_KEY}`);
  assert.equal(supabase.init.method, undefined, "the probe must be a bodyless GET");

  const resend = probeRequest(SERVICES.find((s) => s.id === "resend"), ENV);
  assert.equal(resend.url, "https://api.resend.com/domains", "sending mail would be a side effect");
  assert.equal(resend.init.headers.Authorization, `Bearer ${RESEND_KEY}`);

  const upstash = probeRequest(SERVICES.find((s) => s.id === "upstash"), ENV);
  assert.equal(upstash.url, "https://named-instance.upstash.io/ping");
  assert.equal(upstash.init.headers.Authorization, `Bearer ${UPSTASH_TOKEN}`);

  const giphy = probeRequest(SERVICES.find((s) => s.id === "giphy"), ENV);
  assert.match(giphy.url, /^https:\/\/api\.giphy\.com\/v1\/gifs\/trending\?api_key=/);
  assert.ok(giphy.url.includes(encodeURIComponent(GIPHY_KEY)));
});

test("every probe is read-only and names a secret to rotate", () => {
  for (const service of SERVICES) {
    const request = probeRequest(service, ENV);
    assert.equal(request.init.method, undefined, `${service.id} must not mutate anything`);
    assert.ok(service.vars.includes(service.secret), `${service.id} must name its own secret`);
    assert.ok(service.blastRadius.length > 20, `${service.id} must say what breaks`);
    assert.ok(["fail", "warn"].includes(service.level), `${service.id} needs an alert level`);
  }
});

test("environment values win over files, and files are a fallback", () => {
  const files = ["/repo/apps/web/.dev.vars"];
  const readFile = () => [
    "SUPABASE_SERVICE_ROLE_KEY=from-the-file",
    "GIPHY_API_KEY=from-the-file",
  ].join("\n");

  const fromEnv = loadServiceEnv({ env: { SUPABASE_SERVICE_ROLE_KEY: "from-the-env" }, readFile, files });
  assert.equal(fromEnv.values.SUPABASE_SERVICE_ROLE_KEY, "from-the-env");
  assert.equal(fromEnv.sources.SUPABASE_SERVICE_ROLE_KEY, "environment");
  assert.equal(fromEnv.values.GIPHY_API_KEY, "from-the-file");
  assert.ok(fromEnv.sources.GIPHY_API_KEY.endsWith("apps/web/.dev.vars"));

  const noEnv = loadServiceEnv({ env: {}, readFile, files });
  assert.equal(noEnv.values.SUPABASE_SERVICE_ROLE_KEY, "from-the-file");

  const unreadable = loadServiceEnv({
    env: {},
    readFile: () => {
      throw new Error("ENOENT");
    },
    files,
  });
  assert.deepEqual(unreadable.values, {}, "a missing file on CI is not a finding");
});

test("classifyProbe maps the answers the providers actually give", () => {
  assert.equal(classifyProbe(200), "pass");
  assert.equal(classifyProbe(201), "pass");
  assert.equal(classifyProbe(401), "rejected");
  assert.equal(classifyProbe(403), "rejected");
  assert.equal(classifyProbe(404), "misconfigured");
  assert.equal(classifyProbe(400), "misconfigured");
  assert.equal(classifyProbe(400, '{"message":"API key is invalid"}'), "rejected");
  assert.equal(classifyProbe(400, '{"message":"Invalid api_key"}'), "rejected");
  assert.equal(classifyProbe(429), "unknown");
  assert.equal(classifyProbe(500), "unknown");
  assert.equal(classifyProbe(0), "unknown");
});
