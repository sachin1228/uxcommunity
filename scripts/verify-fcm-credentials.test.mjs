#!/usr/bin/env node

/**
 * Tests for the FCM credential guard's own plumbing.
 *
 *   node --test scripts/verify-fcm-credentials.test.mjs
 *
 * The guard decides whether a deploy proceeds, so every branch that can turn a
 * run red is pinned down here: a healthy service account has to pass, a
 * malformed or double-escaped secret has to fail naming the fix, a key from
 * another Firebase project has to fail before it ships notifications that can
 * never be delivered, and a 5xx or a network error must not block a healthy
 * deploy. It also checks that no branch can leak the private key into a CI log.
 *
 * Nothing here needs the network or a Firebase account: the key pair and the
 * fetch implementation are both local.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  buildAssertion,
  checkFcmCredentials,
  FCM_SCOPE,
  findInterpolatedSecretPush,
  maskEmail,
  parseServiceAccount,
  readAppProjectId,
} from "./verify-fcm-credentials.mjs";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function account(overrides = {}) {
  return JSON.stringify({
    project_id: "uxcommunity",
    client_email: "push@uxcommunity.iam.gserviceaccount.com",
    private_key: privateKey,
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  });
}

const NOW = 1_792_755_742;

function okFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ access_token: "ya29.token", expires_in: 3600 }) };
  };
  return { impl, calls };
}

test("a healthy service account passes and talks to its own token endpoint", async () => {
  const { impl, calls } = okFetch();
  const result = await checkFcmCredentials({
    raw: account(),
    appProjectId: "uxcommunity",
    fetchImpl: impl,
    now: () => NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.projectId, "uxcommunity");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].init.method, "POST");
});

test("the assertion is an RS256 JWT for the messaging scope", async () => {
  const parsed = parseServiceAccount(account());
  const jwt = buildAssertion(parsed.account, NOW);
  const [header, claims, signature] = jwt.split(".");
  assert.equal(header && claims && signature ? 3 : 0, 3);

  const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  const body = decode(claims);
  assert.equal(body.iss, "push@uxcommunity.iam.gserviceaccount.com");
  assert.equal(body.scope, FCM_SCOPE);
  assert.equal(body.iat, NOW);
  assert.equal(body.exp, NOW + 3600);
});

test("an unset secret fails naming the repository secret", async () => {
  const result = await checkFcmCredentials({ raw: "", appProjectId: "uxcommunity" });
  assert.equal(result.ok, false);
  assert.match(result.error, /FCM_SERVICE_ACCOUNT is not set/);
});

test("a non-JSON secret fails instead of shipping a dead credential", async () => {
  const result = await checkFcmCredentials({ raw: "not json", appProjectId: "uxcommunity" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/);
});

test("a secret without a private key names the missing field", () => {
  const parsed = parseServiceAccount(
    JSON.stringify({ project_id: "uxcommunity", client_email: "a@b.c" }),
  );
  assert.match(parsed.error, /private_key/);
});

test("a double-escaped private key is caught before it silently fails signatures", () => {
  const escaped = JSON.stringify({
    project_id: "uxcommunity",
    client_email: "a@b.c",
    private_key: privateKey.replace(/\n/g, "\\n"),
  });
  const parsed = parseServiceAccount(escaped);
  assert.match(parsed.error, /escaped twice/);
});

test("a key from another Firebase project fails with both project names", async () => {
  const result = await checkFcmCredentials({
    raw: account({ project_id: "some-other-app" }),
    appProjectId: "uxcommunity",
    fetchImpl: okFetch().impl,
    now: () => NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /some-other-app/);
  assert.match(result.error, /uxcommunity/);
});

test("a rejected credential fails and quotes Google's error code", async () => {
  const result = await checkFcmCredentials({
    raw: account(),
    appProjectId: "uxcommunity",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
    }),
    now: () => NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 400/);
  assert.match(result.error, /invalid_grant/);
});

test("a 5xx from Google warns and does not block the deploy", async () => {
  const result = await checkFcmCredentials({
    raw: account(),
    appProjectId: "uxcommunity",
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => null }),
    now: () => NOW,
  });
  assert.equal(result.ok, true);
  assert.match(result.warning, /503/);
});

test("a network failure warns and does not block the deploy", async () => {
  const result = await checkFcmCredentials({
    raw: account(),
    appProjectId: "uxcommunity",
    fetchImpl: async () => {
      throw new Error("offline");
    },
    now: () => NOW,
  });
  assert.equal(result.ok, true);
  assert.match(result.warning, /not checked/);
});

test("no branch puts the private key in a message", async () => {
  const marker = privateKey.split("\n")[1].slice(0, 24);
  const failures = [
    await checkFcmCredentials({ raw: "{}", appProjectId: "uxcommunity" }),
    await checkFcmCredentials({
      raw: account({ project_id: "other" }),
      appProjectId: "uxcommunity",
    }),
    await checkFcmCredentials({
      raw: account(),
      appProjectId: "uxcommunity",
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => null }),
      now: () => NOW,
    }),
  ];
  assert.equal(failures.every((result) => result.ok === false), true);
  for (const result of failures) {
    assert.equal(result.error.includes(marker), false);
  }
});

test("the client email is masked in log lines", () => {
  assert.equal(maskEmail("push@uxcommunity.iam.gserviceaccount.com"), "p…@uxcommunity.iam.gserviceaccount.com");
  assert.equal(maskEmail(""), "(none)");
});

test("the app's committed google-services.json is readable and names a project", () => {
  assert.equal(readAppProjectId(), "uxcommunity");
});

test("an interpolated secret push is rejected: bash strips the JSON's quotes", () => {
  const unsafe =
    '        run: printf \'%s\' "${{ secrets.FCM_SERVICE_ACCOUNT }}" | npx wrangler secret put FCM_SERVICE_ACCOUNT';
  assert.equal(findInterpolatedSecretPush(`steps:\n${unsafe}\n`).length, 1);
});

test("an env-based secret push is accepted", () => {
  const safe = [
    "        env:",
    "          FCM_SERVICE_ACCOUNT: ${{ secrets.FCM_SERVICE_ACCOUNT }}",
    '        run: printf \'%s\' "$FCM_SERVICE_ACCOUNT" | npx wrangler secret put FCM_SERVICE_ACCOUNT',
  ].join("\n");
  assert.deepEqual(findInterpolatedSecretPush(`steps:\n${safe}\n`), []);
});

test("this repository's own deploy workflow pushes the secret safely", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  assert.deepEqual(findInterpolatedSecretPush(workflow), []);
});
