#!/usr/bin/env node

/**
 * Tests for the deploy credential guard's own plumbing.
 *
 *   node --test scripts/verify-cloudflare-credentials.test.mjs
 *
 * The guard decides whether a deploy proceeds at all, so every branch that can
 * turn a run red is pinned down here: a healthy credential has to pass, a
 * rejected or expired one has to fail, and the R2 answer has to be read the way
 * the observed failures actually arrive (a dead token answers the bucket check
 * with `401 Authentication error` — the exact text that used to surface as
 * "Failed to provision remote R2 bucket ..."). It also checks the two ways this
 * guard could do harm: calling the wrong URLs, and leaking the token into a log.
 *
 * Nothing here needs the network or a Cloudflare account: `fetch` is injected.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  apiErrorDetail,
  checkCloudflareCredentials,
  classifyBucketLookup,
  classifyTokenVerify,
  expiryNotice,
  EXPIRY_WARNING_DAYS,
  parseR2CacheBucket,
  readR2CacheBucket,
  R2_CACHE_BINDING,
  stripComment,
} from "./verify-cloudflare-credentials.mjs";

const TOKEN = "token-value-that-must-never-be-logged";
const ACCOUNT_ID = "5dfe5cda54b1f61faabfad57e4cec2e9";
const BUCKET = "uxcommunity-web-next-cache";

const ACTIVE = { success: true, result: { id: "abc123", status: "active" }, errors: [], messages: [] };
const BUCKET_FOUND = { success: true, result: { name: BUCKET }, errors: [], messages: [] };
const AUTH_ERROR = {
  success: false,
  errors: [{ code: 10000, message: "Authentication error" }],
  messages: [],
  result: null,
};

/** A fetch stub that answers each URL by the predicate it matches. */
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find((candidate) => candidate.match(String(url)));
    if (!route) throw new Error(`unexpected request: ${url}`);
    if (route.networkError) throw new Error("socket hang up");
    return {
      status: route.status ?? 200,
      json: async () => {
        if (route.body === undefined) throw new Error("not json");
        return route.body;
      },
    };
  };
  return { fetchImpl, calls };
}

const verifyRoute = (route) => ({ match: (url) => url.endsWith("/user/tokens/verify"), ...route });
const accountVerifyRoute = (route) => ({
  match: (url) => url.endsWith(`/accounts/${ACCOUNT_ID}/tokens/verify`),
  ...route,
});
const bucketRoute = (route) => ({ match: (url) => url.includes("/r2/buckets/"), ...route });

/** Runs the guard with a stubbed Cloudflare API. */
async function run({ env = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }, routes, bucketName = BUCKET, now } = {}) {
  const { fetchImpl, calls } = stubFetch(routes);
  const report = await checkCloudflareCredentials({ env, fetchImpl, bucketName, now });
  return { ...report, calls, text: report.lines.map((line) => line.text).join("\n") };
}

// ── Comment and TOML scanning ───────────────────────────────────────────────

test("a comment is stripped, a # inside a quoted value is not", () => {
  assert.equal(stripComment('bucket_name = "a#b" # the real one'), 'bucket_name = "a#b" ');
  assert.equal(stripComment("# whole-line comment"), "");
  assert.equal(stripComment('name = "uxcommunity-web"'), 'name = "uxcommunity-web"');
});

test("the binding's bucket is read out of an [[r2_buckets]] block", () => {
  const toml = [
    'name = "uxcommunity-web"',
    "",
    "# Media lives in another bucket, bound by other config.",
    "[vars]",
    'NEXT_PUBLIC_APP_URL = "https://app.uxcommunity.in"',
    "",
    "[[r2_buckets]]",
    `binding = "${R2_CACHE_BINDING}"`,
    `bucket_name = "${BUCKET}"`,
    "",
    "[[r2_buckets]]",
    'binding = "SOMETHING_ELSE"',
    'bucket_name = "not-this-one"',
  ].join("\n");
  assert.equal(parseR2CacheBucket(toml), BUCKET);
});

test("a block whose binding is not the cache binding is ignored", () => {
  const toml = ['[[r2_buckets]]', 'binding = "MEDIA_BUCKET"', 'bucket_name = "media"'].join("\n");
  assert.equal(parseR2CacheBucket(toml), null);
});

test("the real wrangler.toml yields the bucket Cloudflare actually holds", () => {
  // Drift guard: the guard checks the bucket the deploy provisions, not a copy
  // of its name. Verified against the live account on 2026-10-08.
  assert.equal(readR2CacheBucket(), BUCKET);
});

// ── Expiry reading ──────────────────────────────────────────────────────────

test("no expiry, a distant expiry and an expiry inside the warning window are told apart", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  assert.equal(expiryNotice(undefined, now).kind, "none");
  assert.equal(expiryNotice("2027-01-01T00:00:00Z", now).kind, "ok");
  assert.equal(expiryNotice("2026-10-20T00:00:00Z", now).daysLeft, EXPIRY_WARNING_DAYS - 2);
  assert.equal(expiryNotice("2026-10-20T00:00:00Z", now).kind, "expiring");
  assert.equal(expiryNotice("2026-10-07T00:00:00Z", now).kind, "expired");
  assert.equal(expiryNotice("not-a-date", now).kind, "unknown");
});

// ── Answer classification ───────────────────────────────────────────────────

test("an active token is recognised, a rejected one is not", () => {
  assert.equal(classifyTokenVerify(200, ACTIVE).status, "active");
  assert.equal(classifyTokenVerify(401, AUTH_ERROR).status, "rejected");
  assert.equal(classifyTokenVerify(403, AUTH_ERROR).status, "rejected");
  assert.equal(classifyTokenVerify(200, AUTH_ERROR).status, "rejected");
  assert.equal(classifyTokenVerify(500, { success: false }).status, "unverifiable");
  assert.equal(classifyTokenVerify(0, null).status, "unverifiable");
});

test("Cloudflare's error array is rendered with its code", () => {
  assert.equal(apiErrorDetail(AUTH_ERROR, 401), "Authentication error (code 10000)");
  assert.equal(apiErrorDetail({ errors: [{ message: "nope" }] }, 400), "nope");
  assert.equal(apiErrorDetail(null, 404), "HTTP 404");
});

test("a dead token's 401 on the bucket check is not read as a missing bucket", () => {
  assert.equal(classifyBucketLookup(200, BUCKET_FOUND), "ok");
  assert.equal(classifyBucketLookup(401, AUTH_ERROR), "unauthenticated");
  assert.equal(classifyBucketLookup(403, AUTH_ERROR), "denied");
  assert.equal(classifyBucketLookup(404, { success: false }), "missing");
  assert.equal(classifyBucketLookup(500, { success: false }), "unknown");
  assert.equal(classifyBucketLookup(0, null), "unknown");
});

// ── The guard itself ────────────────────────────────────────────────────────

test("a healthy credential passes and asks exactly the two endpoints the deploy needs", async () => {
  const { ok, exitCode, calls, text } = await run({
    routes: [verifyRoute({ body: ACTIVE }), bucketRoute({ body: BUCKET_FOUND })],
  });
  assert.equal(ok, true);
  assert.equal(exitCode, 0);
  assert.match(text, /CLOUDFLARE_API_TOKEN is active/);
  assert.match(text, new RegExp(`R2 bucket "${BUCKET}"`));
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}`,
    ],
  );
  assert.equal(calls.every((call) => call.init.headers.Authorization === `Bearer ${TOKEN}`), true);
});

test("the token never reaches the report, whatever the answer", async () => {
  for (const routes of [
    [verifyRoute({ body: ACTIVE }), bucketRoute({ body: BUCKET_FOUND })],
    [verifyRoute({ status: 401, body: AUTH_ERROR }), accountVerifyRoute({ status: 401, body: AUTH_ERROR })],
    [verifyRoute({ body: ACTIVE }), bucketRoute({ status: 403, body: AUTH_ERROR })],
  ]) {
    const { text } = await run({ routes });
    assert.equal(text.includes(TOKEN), false, text);
  }
});

test("the 2026-10-08 signature — 401 Authentication error — fails and names the secret to rotate", async () => {
  const { ok, exitCode, text, calls } = await run({
    routes: [
      verifyRoute({ status: 401, body: AUTH_ERROR }),
      accountVerifyRoute({ status: 401, body: AUTH_ERROR }),
    ],
  });
  assert.equal(ok, false);
  assert.equal(exitCode, 1);
  assert.match(text, /Cloudflare rejected CLOUDFLARE_API_TOKEN at both verify endpoints: Authentication error \(code 10000\)/);
  assert.match(text, /My Profile → API Tokens/);
  // Nothing else is asked once both endpoints reject the credential: the bucket
  // check would only repeat the same 401.
  assert.equal(calls.length, 2);
});

test("an account-owned token the user endpoint rejects is still verified at the account endpoint", async () => {
  // Cloudflare's account-owned tokens answer `401 code 1000 Invalid API Token`
  // on /user/tokens/verify however healthy they are. Every permission a deploy
  // needs can live on either kind, so rejecting this one would fail a working
  // credential — and did, on the preview run of 2026-10-08.
  const invalidToken = {
    success: false,
    errors: [{ code: 1000, message: "Invalid API Token" }],
    messages: [],
    result: null,
  };
  const { ok, exitCode, calls, text } = await run({
    routes: [
      verifyRoute({ status: 401, body: invalidToken }),
      accountVerifyRoute({ body: ACTIVE }),
      bucketRoute({ body: BUCKET_FOUND }),
    ],
  });
  assert.equal(ok, true);
  assert.equal(exitCode, 0);
  assert.match(text, /CLOUDFLARE_API_TOKEN is active \(id abc123\)/);
  assert.match(text, new RegExp(`R2 bucket "${BUCKET}"`));
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/tokens/verify`,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}`,
    ],
  );
});

test("an account-owned token's expiry comes from the endpoint that verified it", async () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const invalidToken = {
    success: false,
    errors: [{ code: 1000, message: "Invalid API Token" }],
    messages: [],
    result: null,
  };
  const { ok, exitCode, text } = await run({
    now,
    routes: [
      verifyRoute({ status: 401, body: invalidToken }),
      accountVerifyRoute({
        body: { ...ACTIVE, result: { id: "abc123", status: "active", expires_on: "2026-10-15T00:00:00Z" } },
      }),
      bucketRoute({ body: BUCKET_FOUND }),
    ],
  });
  assert.equal(ok, true);
  assert.equal(exitCode, 0);
  assert.match(text, /expires in 7 day\(s\), on 2026-10-15T00:00:00Z/);
});

test("a missing or empty secret fails with the repository secret named", async () => {
  const noToken = await run({ env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }, routes: [] });
  assert.equal(noToken.exitCode, 1);
  assert.match(noToken.text, /CLOUDFLARE_API_TOKEN is not set/);
  assert.match(noToken.text, /repository secret/);

  const noAccount = await run({ env: { CLOUDFLARE_API_TOKEN: TOKEN }, routes: [] });
  assert.equal(noAccount.exitCode, 1);
  assert.match(noAccount.text, /CLOUDFLARE_ACCOUNT_ID is not set/);

  const blank = await run({ env: { CLOUDFLARE_API_TOKEN: "   ", CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }, routes: [] });
  assert.equal(blank.exitCode, 1);
  assert.match(blank.text, /CLOUDFLARE_API_TOKEN is not set/);
});

test("a token inside its expiry warning window passes the deploy but warns", async () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const { ok, exitCode, text } = await run({
    now,
    routes: [
      verifyRoute({ body: { ...ACTIVE, result: { id: "abc123", status: "active", expires_on: "2026-10-15T00:00:00Z" } } }),
      bucketRoute({ body: BUCKET_FOUND }),
    ],
  });
  assert.equal(ok, true);
  assert.equal(exitCode, 0);
  assert.match(text, /expires in 7 day\(s\), on 2026-10-15T00:00:00Z/);
  assert.match(text, /Rotate it before then/);
});

test("an expired token fails even when Cloudflare still answers verify", async () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const { exitCode, text } = await run({
    now,
    routes: [verifyRoute({ body: { ...ACTIVE, result: { id: "abc123", status: "active", expires_on: "2026-10-01T00:00:00Z" } } })],
  });
  assert.equal(exitCode, 1);
  assert.match(text, /expired on 2026-10-01T00:00:00Z/);
});

test("a token without R2 access fails naming Workers R2 Storage, not OpenNext", async () => {
  const { exitCode, text } = await run({
    routes: [verifyRoute({ body: ACTIVE }), bucketRoute({ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } })],
  });
  assert.equal(exitCode, 1);
  assert.match(text, /cannot read R2 bucket "uxcommunity-web-next-cache"/);
  assert.match(text, /"Workers R2 Storage: Edit" permission/);
});

test("a missing bucket fails with the one command that creates it", async () => {
  const { exitCode, text } = await run({
    routes: [verifyRoute({ body: ACTIVE }), bucketRoute({ status: 404, body: { success: false, errors: [{ code: 10006, message: "bucket not found" }] } })],
  });
  assert.equal(exitCode, 1);
  assert.match(text, /does not exist/);
  assert.match(text, /npx wrangler r2 bucket create uxcommunity-web-next-cache/);
});

test("a dead token still fails the bucket check when verify was unreadable", async () => {
  // A 5xx on verify only warns, so the bucket check is what catches it there.
  const { exitCode, text } = await run({
    routes: [verifyRoute({ status: 502, body: undefined }), bucketRoute({ status: 401, body: AUTH_ERROR })],
  });
  assert.equal(exitCode, 1);
  assert.match(text, /Could not verify CLOUDFLARE_API_TOKEN/);
  assert.match(text, /rejected CLOUDFLARE_API_TOKEN while checking R2 bucket/);
});

test("API trouble warns instead of failing a deploy that would otherwise work", async () => {
  const { ok, exitCode, text } = await run({
    routes: [verifyRoute({ networkError: true }), bucketRoute({ status: 503, body: undefined })],
  });
  assert.equal(ok, true);
  assert.equal(exitCode, 0);
  assert.match(text, /Could not verify CLOUDFLARE_API_TOKEN/);
  assert.match(text, /Could not check R2 bucket/);
  assert.doesNotMatch(text, /FAIL/);
});

test("no cache binding means no bucket check, and no failure", async () => {
  const { ok, exitCode, text, calls } = await run({
    bucketName: null,
    routes: [verifyRoute({ body: ACTIVE })],
  });
  assert.equal(ok, true);
  assert.equal(exitCode, 0);
  assert.match(text, new RegExp(`No ${R2_CACHE_BINDING} R2 binding`));
  assert.equal(calls.length, 1);
});
