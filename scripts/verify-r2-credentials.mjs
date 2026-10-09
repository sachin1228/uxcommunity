#!/usr/bin/env node

/**
 * Preflight guard for the R2 media credentials every upload route uses.
 *
 * WHY THIS EXISTS
 *   On 2026-10-09 every R2-backed upload in the product — community threads,
 *   showcase posts, event images, profile avatars, chat attachments — began
 *   answering `500` with this in the Worker logs:
 *
 *     [profile/avatar] R2 upload error: Unauthorized: Unauthorized
 *       at async uploadToR2 (apps/web/lib/r2.ts:190:3)
 *       '$metadata': { httpStatusCode: 401, ... }, Code: 'Unauthorized'
 *
 *   All of those routes funnel through one S3-compatible client in
 *   apps/web/lib/r2.ts built from `R2_ACCESS_KEY_ID` and
 *   `R2_SECRET_ACCESS_KEY`, so one rejected credential took out every media
 *   feature at once while Supabase, realtime and the rest of the app stayed
 *   green. The credential was written to the Worker by the deploy workflow and
 *   nobody ever asked it to prove it still worked: the app found out on the
 *   first user upload, and the only trace was a 401 from a stack frame inside
 *   the AWS SDK. This is the same failure shape as the 2026-10-08
 *   `CLOUDFLARE_API_TOKEN` incident that scripts/verify-cloudflare-credentials.mjs
 *   exists for — a dead repository credential discovered from the deepest layer
 *   of the stack.
 *
 * WHAT IT PROVES — in seconds, before the build, before anything is deployed:
 *   1. the R2 media vars are present at all, and which one is missing when they
 *      are not;
 *   2. the credential can actually PUT an object into the media bucket — the
 *      exact operation `uploadToR2` performs — so a revoked, rotated or
 *      account-mismatched key fails here instead of as a 500 on a user's
 *      avatar;
 *   3. the object it wrote can be read back and deleted, so the probe proves
 *      the same read/delete permissions the media lifecycle cleanup needs and
 *      leaves nothing behind;
 *   4. `R2_PUBLIC_URL` is set, because every upload returns a URL built from it.
 *
 *   A 401/403 from R2, or a bucket R2 says does not exist, is a credential or
 *   configuration problem and exits 1 naming the secret to fix. A 5xx or a
 *   network error is reported as a warning and the pipeline continues: this
 *   guard exists to catch a dead credential, not to become a new way for a
 *   healthy deploy to go red.
 *
 * WHERE THE VALUES COME FROM
 *   `process.env` first — that is what both deploy workflows pass, from the
 *   repository secrets — then the same files a local run reads, in the order
 *   local tooling reads them: apps/web/.dev.vars (wrangler dev /
 *   opennextjs-cloudflare preview), apps/web/.env.local (next dev), then
 *   apps/web/.env. So `npm run verify:r2` checks exactly the credential the
 *   developer's dev server would use.
 *
 *   The credential is never printed. The access key id is reported as a masked
 *   fingerprint (`fb30…d8f`) so an operator can tell which of two keys is being
 *   rejected without a full value ending up in a CI log.
 *
 * USAGE
 *   node scripts/verify-r2-credentials.mjs
 *   npm run verify:r2
 *
 * EXIT CODE
 *   1 when the credential cannot do what uploads need, 0 when it can. Both
 *   deploy workflows block on it, and its helpers are unit-tested
 *   (scripts/verify-r2-credentials.test.mjs) so a wrong guard cannot fail a
 *   healthy deploy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The five vars apps/web/lib/r2.ts needs; each is named in the failure text. */
export const R2_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
];

/** Files a local run reads, in the precedence the local tooling uses. */
export const ENV_FILE_CANDIDATES = [
  path.join(ROOT, "apps", "web", ".dev.vars"),
  path.join(ROOT, "apps", "web", ".env.local"),
  path.join(ROOT, "apps", "web", ".env"),
];

/** Every probe object lives under this prefix, never in a media prefix. */
export const PROBE_PREFIX = "healthcheck/";

/** Nothing here may hang a job: every request is bounded. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** How the failure text tells the operator to fix a rejected credential. */
const ROTATE_HINT =
  "Rotate it in the Cloudflare dashboard (R2 → API → Manage API Tokens → Create API Token, with " +
  "\"Object Read & Write\" on the media bucket), then update the repository secret (Settings → " +
  "Secrets and variables → Actions) AND every local env file — apps/web/.dev.vars, " +
  "apps/web/.env.local and apps/web/.env — because a deploy only pushes what those secrets hold. " +
  "A rolled secret, a revoked token, a token created for another Cloudflare account and a token " +
  "that was never given access to the bucket all look exactly like this.";

/**
 * Masks a credential so two candidate keys can be told apart in a log.
 *
 * @param value The access key id (or any credential string).
 * @returns `fb30…d8f` for a long value, `***` for a short or missing one.
 */
export function fingerprint(value) {
  const text = String(value ?? "");
  if (text.length < 12) return "***";
  return `${text.slice(0, 4)}…${text.slice(-3)}`;
}

/**
 * Parses the dotenv-shaped files a local run may have on disk.
 *
 * @param text Contents of a `.dev.vars` / `.env*` file.
 * @returns Every assigned key, with surrounding quotes stripped.
 */
export function parseEnvFile(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const entry = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!entry) continue;
    values[entry[1]] = entry[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

/**
 * Resolves the R2 vars this guard checks: environment first, then the local
 * files, so CI (which passes the repository secrets) and a developer's shell
 * (which has none) both work without flags.
 *
 * @param options.env Environment to read from; defaults to `process.env`.
 * @param options.readFile Injected for tests.
 * @param options.files Files to fall back to, in precedence order.
 * @returns `{ values, sources }`; `sources` maps each var to where it came from.
 */
export function loadR2Env({
  env = process.env,
  readFile = (file) => readFileSync(file, "utf8"),
  files = ENV_FILE_CANDIDATES,
} = {}) {
  const values = {};
  const sources = {};

  for (const name of R2_ENV_VARS) {
    const fromEnv = String(env[name] ?? "").trim();
    if (fromEnv) {
      values[name] = fromEnv;
      sources[name] = "environment";
    }
  }

  for (const file of files) {
    let parsed;
    try {
      parsed = parseEnvFile(readFile(file));
    } catch {
      // Missing or unreadable is expected on a CI runner and is not a finding.
      continue;
    }
    for (const name of R2_ENV_VARS) {
      if (values[name]) continue;
      const value = String(parsed[name] ?? "").trim();
      if (!value) continue;
      values[name] = value;
      sources[name] = path.relative(ROOT, file);
    }
  }

  return { values, sources };
}

/**
 * Classifies a failed R2 command.
 *
 * The AWS SDK surfaces an S3 error twice: as `$metadata.httpStatusCode` plus
 * the error `name`, and in the parsed body. R2 answers a rejected credential
 * with a bare `401 Unauthorized` (verified by hand: a rotated key, a bogus key
 * and a valid key with a wrong secret are indistinguishable from outside), so
 * every 401 and 403 has to be treated as a credential problem, and a missing
 * bucket has to be separated from it by name.
 *
 * @param error Whatever the client threw.
 * @returns `{ kind, status, detail }` where `kind` is `auth`, `denied`,
 *   `missing-bucket`, or `unknown`.
 */
export function classifyR2Error(error) {
  const status = Number(error?.$metadata?.httpStatusCode ?? error?.status ?? 0);
  const name = String(error?.name ?? error?.Code ?? error?.code ?? "");
  const detail = String(error?.message ?? name ?? "unknown error");

  if (name === "NoSuchBucket" || /NoSuchBucket/i.test(detail)) {
    return { kind: "missing-bucket", status, detail };
  }
  if (status === 401 || /Unauthorized/i.test(name)) {
    return { kind: "auth", status, detail };
  }
  if (status === 403 || /AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId/i.test(name)) {
    return { kind: "denied", status, detail };
  }
  return { kind: "unknown", status, detail };
}

/**
 * Checks that the R2 media credential can do what every upload route needs.
 *
 * @param options.env Environment to read the vars from.
 * @param options.readFile Injected file reader, for tests.
 * @param options.files Files to fall back to, in precedence order.
 * @param options.createClient Builds an S3-compatible client; injected so the
 *   failure branches can be exercised without R2 or the AWS SDK. May be async —
 *   the real factory imports the SDK lazily so a guard run never pays for it
 *   when the vars are already wrong.
 * @param options.commands The probe's command classes, injected for the same
 *   reason: its unit tests then run with no `node_modules` at all.
 * @param options.now Reference time (probe keys are time-ordered).
 * @returns `{ ok, exitCode, lines, values }` where each line is
 *   `{ level, text }` and `level` is `ok`, `warn` or `fail`. No line ever
 *   contains a credential value.
 */
export async function checkR2Credentials({
  env = process.env,
  readFile,
  files,
  createClient,
  commands,
  now = Date.now(),
} = {}) {
  const lines = [];
  const ok = (text) => lines.push({ level: "ok", text });
  const warn = (text) => lines.push({ level: "warn", text });
  const fail = (text) => lines.push({ level: "fail", text });

  const { values, sources } = loadR2Env({ env, readFile, files });

  const missing = R2_ENV_VARS.filter((name) => !values[name]);
  if (missing.length) {
    fail(
      `R2 media storage is not configured: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
        `missing from the environment and from every file a local run reads. Uploads (threads, ` +
        `showcase, events, avatars, chat attachments) fail with a 500 until all five are set. ` +
        ROTATE_HINT,
    );
    return { ok: false, exitCode: 1, lines, values };
  }

  ok(
    `R2 media vars are present (access key ${fingerprint(values.R2_ACCESS_KEY_ID)}, bucket ` +
      `"${values.R2_BUCKET_NAME}", key id from ${sources.R2_ACCESS_KEY_ID ?? "environment"}).`,
  );

  if (!createClient || !commands) {
    // Only reachable when this module is used as a library without a factory.
    fail("No R2 client was provided, so the credential could not be exercised.");
    return { ok: false, exitCode: 1, lines, values };
  }
  const { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = commands;

  const client = await createClient({
    accountId: values.R2_ACCOUNT_ID,
    accessKeyId: values.R2_ACCESS_KEY_ID,
    secretAccessKey: values.R2_SECRET_ACCESS_KEY,
  });
  const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const probeKey = `${PROBE_PREFIX}r2-credential-probe-${new Date(now).toISOString().replace(/[:.]/g, "-")}.txt`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: values.R2_BUCKET_NAME,
        Key: probeKey,
        Body: Buffer.from("r2 credential probe"),
        ContentType: "text/plain",
      }),
      { abortSignal: signal() },
    );
  } catch (error) {
    const { kind, status, detail } = classifyR2Error(error);
    if (kind === "auth") {
      fail(
        `Cloudflare R2 rejected the media credential (HTTP ${status || 401}: ${detail}) while ` +
          `writing a probe object to bucket "${values.R2_BUCKET_NAME}". Every upload route uses ` +
          `the same client, so this is the 500 users see on threads, showcase, events, avatars ` +
          `and chat attachments. Fix R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (access key ` +
          `${fingerprint(values.R2_ACCESS_KEY_ID)}). ${ROTATE_HINT}`,
      );
    } else if (kind === "denied") {
      fail(
        `Cloudflare R2 denied the write (HTTP ${status || 403}: ${detail}) to bucket ` +
          `"${values.R2_BUCKET_NAME}". The token needs "Object Read & Write" on that bucket: a ` +
          `read-only token authenticates fine and then fails on the first upload. ${ROTATE_HINT}`,
      );
    } else if (kind === "missing-bucket") {
      fail(
        `Cloudflare R2 says bucket "${values.R2_BUCKET_NAME}" (R2_BUCKET_NAME) does not exist ` +
          `(${detail}). Point R2_BUCKET_NAME at the media bucket, or check that R2_ACCOUNT_ID ` +
          `belongs to the account that owns it.`,
      );
    } else {
      warn(
        `Could not probe bucket "${values.R2_BUCKET_NAME}" (${status ? `HTTP ${status}: ` : ""}${detail}); ` +
          `continuing — a dead credential fails loudly here, but a 5xx or a network error must not ` +
          `block an otherwise healthy deploy.`,
      );
    }
    const failed = lines.some((line) => line.level === "fail");
    return { ok: !failed, exitCode: failed ? 1 : 0, lines, values };
  }

  ok(`R2 accepted a write to "${values.R2_BUCKET_NAME}" (${probeKey}).`);

  let readBack = false;
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: values.R2_BUCKET_NAME, Key: probeKey }),
      { abortSignal: signal() },
    );
    readBack = true;
    ok("R2 serves the probe object back, so the token can read what it wrote.");
  } catch (error) {
    warn(
      `The probe object could not be read back (${error?.message ?? error}); the write itself ` +
        `succeeded, so uploads work, but check the token's read permission when convenient.`,
    );
  }

  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: values.R2_BUCKET_NAME, Key: probeKey }),
      { abortSignal: signal() },
    );
    ok("Probe object deleted — nothing left behind.");
  } catch (error) {
    warn(
      `The probe object could not be deleted (${error?.message ?? error}); remove ` +
        `"${probeKey}" by hand. The media orphan audit reclaims unreferenced objects, so it will ` +
        `also be swept up there.`,
    );
  }

  if (readBack) {
    ok(`R2_PUBLIC_URL base: ${values.R2_PUBLIC_URL}`);
  }

  return { ok: true, exitCode: 0, lines, values };
}

/**
 * Builds the real S3-compatible client, matching apps/web/lib/r2.ts: the same
 * endpoint, the same `region: "auto"`, the same path the app signs with. One
 * attempt only — a retry storm against a rejected credential helps nobody.
 *
 * @returns A client whose `send` accepts the probe commands.
 */
async function realClientFactory({ accountId, accessKeyId, secretAccessKey }) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  });
}

async function main() {
  const startedAt = Date.now();
  const { exitCode, lines } = await checkR2Credentials({
    env: process.env,
    createClient: realClientFactory,
    commands: await import("@aws-sdk/client-s3"),
  });

  for (const line of lines) {
    const prefix = line.level === "fail" ? "  FAIL " : line.level === "warn" ? "  warn " : "  ok   ";
    (line.level === "fail" ? console.error : console.log)(`${prefix}${line.text}`);
  }

  if (exitCode === 0) {
    console.log(`R2 media credentials verified in ${Date.now() - startedAt}ms.`);
  } else {
    console.error(
      "R2 media credential check FAILED. This is a credential, not application code: uploads " +
        "stay broken for every user until the value above is rotated and redeployed.",
    );
  }
  process.exitCode = exitCode;
}

// Only run when invoked directly, so the helpers above stay importable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`R2 media credential check FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
