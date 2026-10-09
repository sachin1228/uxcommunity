#!/usr/bin/env node

/**
 * Tests for the R2 media credential guard's own plumbing.
 *
 *   node --test scripts/verify-r2-credentials.test.mjs
 *
 * The guard decides whether a deploy proceeds, so every branch that can turn a
 * run red is pinned down here: a healthy credential has to pass, a rejected or
 * under-permissioned one has to fail naming the secret, a missing bucket must
 * not be reported as a bad key, and a 5xx must not block a healthy deploy. It
 * also checks the two ways this guard could do harm: leaking a credential into
 * a log, and writing the probe anywhere but the healthcheck prefix.
 *
 * Nothing here needs the network or a Cloudflare account: the env files and the
 * S3 client are both injected.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkR2Credentials,
  classifyR2Error,
  fingerprint,
  loadR2Env,
  parseEnvFile,
  PROBE_PREFIX,
  R2_ENV_VARS,
} from "./verify-r2-credentials.mjs";

// Stand-ins for the SDK's command classes, so this suite runs in the CI job
// that deliberately has no `node_modules` (`npm ci` is what the guard is there
// to not depend on). The guard only ever reads `command.input`, so the shape
// they have to reproduce is that one property.
class PutObjectCommand {
  constructor(input) {
    this.input = input;
  }
}
class HeadObjectCommand {
  constructor(input) {
    this.input = input;
  }
}
class DeleteObjectCommand {
  constructor(input) {
    this.input = input;
  }
}
const COMMANDS = { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand };

const ACCESS_KEY = "fb30b8aaaaaaaaaaaaaaaaaaaaaaaaad8f";
const SECRET_KEY = "2316bdzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz578";
const BUCKET = "drafthub";

const GOOD_ENV = {
  R2_ACCOUNT_ID: "5dfe5cda54b1f61faabfad57e4cec2e9",
  R2_ACCESS_KEY_ID: ACCESS_KEY,
  R2_SECRET_ACCESS_KEY: SECRET_KEY,
  R2_BUCKET_NAME: BUCKET,
  R2_PUBLIC_URL: "https://media.example.in",
};

/** An S3 error shaped the way the AWS SDK reports one. */
function s3Error({ name, status, message }) {
  const error = new Error(message ?? name);
  error.name = name;
  error.$metadata = { httpStatusCode: status, attempts: 1 };
  return error;
}

/**
 * A stub client: `handlers` maps a command class name to what `send` does for
 * it — return a value, throw an error, or (absent) succeed.
 */
function stubClient(handlers = {}) {
  const sent = [];
  return {
    sent,
    async send(command) {
      const kind = command.constructor.name;
      sent.push({ kind, key: command.input?.Key, bucket: command.input?.Bucket });
      const handler = handlers[kind];
      if (!handler) return {};
      return handler(command);
    },
  };
}

/**
 * Runs the guard against `env` only — the real .dev.vars / .env* files on a
 * developer's disk must never leak into a test's expectations.
 */
const check = (handlers, { env = GOOD_ENV } = {}) => {
  const client = stubClient(handlers);
  return checkR2Credentials({
    env,
    files: [],
    createClient: () => client,
    commands: COMMANDS,
  }).then((result) => ({ ...result, client }));
};

const text = (result) => result.lines.map((line) => line.text).join("\n");

test("fingerprint never reveals a whole credential but separates two keys", () => {
  assert.equal(fingerprint(ACCESS_KEY), "fb30…d8f");
  assert.equal(fingerprint("short"), "***");
  assert.equal(fingerprint(undefined), "***");
  assert.notEqual(fingerprint(ACCESS_KEY), fingerprint("aaaa1111bbbb2222cccc3333dddd4444"));
});

test("parseEnvFile reads dotenv lines and strips quotes", () => {
  assert.deepEqual(parseEnvFile('R2_BUCKET_NAME="drafthub"\n# comment\nR2_PUBLIC_URL=https://x.in\n'), {
    R2_BUCKET_NAME: "drafthub",
    R2_PUBLIC_URL: "https://x.in",
  });
});

test("loadR2Env prefers the environment and falls back to the local files in order", () => {
  const files = {
    "/dev.vars": "R2_BUCKET_NAME=from-dev-vars\nR2_ACCESS_KEY_ID=devkey\n",
    "/env.local": "R2_ACCESS_KEY_ID=local-key\nR2_SECRET_ACCESS_KEY=local-secret\n",
    "/.env": "R2_SECRET_ACCESS_KEY=env-secret\nR2_PUBLIC_URL=https://env.in\n",
  };
  const { values, sources } = loadR2Env({
    env: { R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "from-env" },
    files: ["/dev.vars", "/env.local", "/.env"],
    readFile: (file) => {
      if (!(file in files)) throw new Error(`ENOENT: ${file}`);
      return files[file];
    },
  });

  assert.equal(values.R2_ACCOUNT_ID, "acct");
  assert.equal(values.R2_ACCESS_KEY_ID, "from-env");
  assert.equal(values.R2_BUCKET_NAME, "from-dev-vars");
  assert.equal(values.R2_SECRET_ACCESS_KEY, "local-secret");
  assert.equal(values.R2_PUBLIC_URL, "https://env.in");
  assert.equal(sources.R2_ACCOUNT_ID, "environment");
  assert.equal(sources.R2_ACCESS_KEY_ID, "environment");
});

test("classifyR2Error reads the SDK's metadata, not just the message", () => {
  assert.equal(classifyR2Error(s3Error({ name: "Unauthorized", status: 401 })).kind, "auth");
  assert.equal(classifyR2Error(s3Error({ name: "AccessDenied", status: 403 })).kind, "denied");
  assert.equal(
    classifyR2Error(s3Error({ name: "NoSuchBucket", status: 404 })).kind,
    "missing-bucket",
  );
  assert.equal(classifyR2Error(s3Error({ name: "InternalError", status: 500 })).kind, "unknown");
  assert.equal(classifyR2Error(new Error("socket hang up")).kind, "unknown");
});

test("a healthy credential passes and leaves no probe object behind", async () => {
  const result = await check({});
  assert.equal(result.exitCode, 0);
  assert.equal(result.ok, true);
  assert.match(text(result), /R2 accepted a write to "drafthub"/);
  const kinds = result.client.sent.map((entry) => entry.kind);
  assert.deepEqual(kinds, ["PutObjectCommand", "HeadObjectCommand", "DeleteObjectCommand"]);
  assert.ok(
    result.client.sent.every((entry) => entry.bucket === BUCKET),
    "every probe call must target the configured bucket",
  );
});

test("the probe only ever writes under the healthcheck prefix", async () => {
  const result = await check({});
  const put = result.client.sent.find((entry) => entry.kind === "PutObjectCommand");
  assert.ok(put.key.startsWith(PROBE_PREFIX), `probe key escaped the prefix: ${put.key}`);
  const del = result.client.sent.find((entry) => entry.kind === "DeleteObjectCommand");
  assert.equal(del.key, put.key);
});

test("a 401 names the key secret and never logs a credential value", async () => {
  const result = await check({
    PutObjectCommand: () => {
      throw s3Error({ name: "Unauthorized", status: 401, message: "Unauthorized" });
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.ok, false);
  const output = text(result);
  assert.match(output, /R2 rejected the media credential/);
  assert.match(output, /R2_ACCESS_KEY_ID \/ R2_SECRET_ACCESS_KEY/);
  assert.match(output, /fb30…d8f/, "the masked fingerprint should identify which key was rejected");
  assert.ok(!output.includes(SECRET_KEY), "the secret must never reach a log");
  assert.ok(!output.includes(ACCESS_KEY), "the full access key id must never reach a log");
  assert.ok(!output.includes(GOOD_ENV.R2_ACCOUNT_ID), "the account id must never reach a log");
});

test("a 403 says the token needs write access, not that it is dead", async () => {
  const result = await check({
    PutObjectCommand: () => {
      throw s3Error({ name: "AccessDenied", status: 403, message: "Access Denied" });
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(text(result), /denied the write/);
  assert.match(text(result), /Object Read & Write/);
});

test("a missing bucket is reported as R2_BUCKET_NAME, not as a bad key", async () => {
  const result = await check({
    PutObjectCommand: () => {
      throw s3Error({ name: "NoSuchBucket", status: 404, message: "The specified bucket does not exist" });
    },
  });

  assert.equal(result.exitCode, 1);
  const output = text(result);
  assert.match(output, /does not exist/);
  assert.match(output, /R2_BUCKET_NAME/);
  assert.ok(!output.includes("R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY"), "not a key problem");
});

test("a 5xx or a network error warns instead of blocking a healthy deploy", async () => {
  for (const error of [
    s3Error({ name: "InternalError", status: 500, message: "We encountered an internal error" }),
    new Error("socket hang up"),
  ]) {
    const result = await check({ PutObjectCommand: () => { throw error; } });
    assert.equal(result.exitCode, 0, `${error.message} must not fail the deploy`);
    assert.match(text(result), /continuing/);
    assert.ok(result.lines.every((line) => line.level !== "fail"));
  }
});

test("a successful write still passes when cleanup fails, naming the leftover key", async () => {
  const result = await check({
    DeleteObjectCommand: (command) => {
      throw s3Error({ name: "AccessDenied", status: 403, message: "Access Denied" });
    },
  });

  assert.equal(result.exitCode, 0);
  const output = text(result);
  assert.match(output, /could not be deleted/);
  const put = result.client.sent.find((entry) => entry.kind === "PutObjectCommand");
  assert.ok(output.includes(put.key), "the warning must name the object left behind");
});

test("missing configuration fails and names every absent var without touching R2", async () => {
  for (const name of R2_ENV_VARS) {
    const env = { ...GOOD_ENV };
    delete env[name];
    const client = stubClient({});
    const result = await checkR2Credentials({
      env,
      files: [],
      createClient: () => client,
      commands: COMMANDS,
    });

    assert.equal(result.exitCode, 1, `${name} must be required`);
    assert.match(text(result), new RegExp(name));
    assert.equal(client.sent.length, 0, "no request may be made without credentials");
  }
});
