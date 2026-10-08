#!/usr/bin/env node

/**
 * Preflight guard for the Cloudflare credentials the deploy workflows use.
 *
 * WHY THIS EXISTS
 *   On 2026-10-08 the `CLOUDFLARE_API_TOKEN` repository secret stopped being
 *   accepted. Every Cloudflare call CI made answered
 *   `401 {"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`,
 *   but the failure that surfaced — and the one the deploy log ended on — was
 *   this, from the web deploy:
 *
 *     Error: Failed to provision remote R2 bucket "uxcommunity-web-next-cache"
 *     for binding "NEXT_INC_CACHE_R2_BUCKET": Failed to check whether bucket
 *     exists: 401 ... Authentication error
 *
 *   That message reads like an OpenNext or an R2 problem and is neither. It is
 *   `opennextjs-cloudflare deploy` checking the incremental-cache bucket with
 *   the same dead token the run had already failed to deploy the realtime
 *   worker with, and the same token the preview cleanup job could not delete a
 *   worker with. Three different Cloudflare calls, one credential, and no step
 *   anywhere in either workflow that asked the credential to prove it still
 *   works: the pipeline spent a full OpenNext build on the way to the first
 *   API call, then reported the symptom from the deepest layer (OpenNext's R2
 *   provisioning) instead of the cause (the token).
 *
 * WHAT IT PROVES — before a build, before a bucket is provisioned, before
 * anything is deployed:
 *   1. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are present at all
 *      (the workflows already check non-emptiness; the messages here name the
 *      repository secret to fix);
 *   2. the token is LIVE. `GET /user/tokens/verify` needs no permission of its
 *      own, so a rejection there is the credential itself — an expired TTL, a
 *      revoked token, or an edited one — and never a missing scope;
 *   3. the token is not about to expire. The same endpoint returns
 *      `expires_on`, so a TTL that is about to run out is a warning on the
 *      deploy that still works instead of a 401 on the one that does not;
 *   4. the bucket `NEXT_INC_CACHE_R2_BUCKET` binds in apps/web/wrangler.toml
 *      is readable with this token. This mirrors the existence check OpenNext
 *      runs before it publishes, so a token that is valid but was never given
 *      the R2 permission the web deploy needs fails here, in seconds, naming
 *      `Workers R2 Storage` — instead of aborting the deploy halfway through
 *      with `Failed to provision remote R2 bucket`.
 *
 *   The bucket is read from the worker's own wrangler.toml rather than
 *   hard-coded, so the guard cannot drift away from what the deploy actually
 *   provisions; when the binding is absent the R2 check is skipped (and says
 *   so) rather than failing a deploy that does not need it.
 *
 * WHY A 5xx IS NOT A FAILURE
 *   This guard exists to catch a dead credential, not to become a new way for a
 *   healthy deploy to go red. A network error or a 5xx from the API is reported
 *   as a warning and the deploy continues: the call that matters will fail with
 *   Cloudflare's own error in that case anyway.
 *
 * USAGE
 *   node scripts/verify-cloudflare-credentials.mjs
 *   npm run verify:cloudflare
 *
 *   Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment —
 *   the two values the deploy workflows take from repository secrets. The token
 *   is never printed.
 *
 * EXIT CODE
 *   1 when this credential cannot do what the pipeline needs, 0 when it can.
 *   Both deploy workflows block on it, and its helpers are unit-tested
 *   (scripts/verify-cloudflare-credentials.test.mjs) so a wrong guard cannot
 *   fail a healthy deploy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Cloudflare's public API — the same one wrangler and OpenNext call. */
const API_BASE = "https://api.cloudflare.com/client/v4";
/** Where the web worker declares the binding this guard has to resolve. */
export const WRANGLER_CONFIG_PATH = path.join(ROOT, "apps", "web", "wrangler.toml");
/** The R2 binding `opennextjs-cloudflare deploy` provisions before publishing. */
export const R2_CACHE_BINDING = "NEXT_INC_CACHE_R2_BUCKET";
/** Warn this many days before a token TTL takes the deploy down with it. */
export const EXPIRY_WARNING_DAYS = 14;
/** Nothing here may hang a job: every request is bounded. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Removes a TOML comment without touching a `#` inside a quoted value.
 *
 * @param line A single line of TOML.
 * @returns The line with any trailing comment removed.
 */
export function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return line.slice(0, index);
    }
  }
  return line;
}

/**
 * Reads the bucket name bound to {@link R2_CACHE_BINDING} out of wrangler.toml.
 *
 * Deliberately a scanner over `[[r2_buckets]]` blocks rather than a TOML
 * dependency: it needs one key from one block, and the file is a tracked
 * artifact both the deploy and the guard read.
 *
 * @param tomlText The contents of a wrangler config.
 * @returns The bound bucket name, or null when no such binding is declared.
 */
export function parseR2CacheBucket(tomlText) {
  const blocks = [];
  let current = null;
  for (const rawLine of String(tomlText).split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === "") continue;
    if (line.startsWith("[[")) {
      current = line === "[[r2_buckets]]" ? {} : null;
      if (current) blocks.push(current);
      continue;
    }
    // Any other section (or table) ends the block being scanned.
    if (line.startsWith("[")) {
      current = null;
      continue;
    }
    if (!current) continue;
    const entry = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!entry) continue;
    current[entry[1]] = entry[2].trim().replace(/^["']|["']$/g, "");
  }
  const block = blocks.find((candidate) => candidate.binding === R2_CACHE_BINDING);
  const bucket = block?.bucket_name;
  return typeof bucket === "string" && bucket !== "" ? bucket : null;
}

/**
 * Resolves the incremental-cache bucket from the web worker's config on disk.
 *
 * @param configPath Override for tests.
 * @returns The bucket name, or null when the file or the binding is missing.
 */
export function readR2CacheBucket(configPath = WRANGLER_CONFIG_PATH) {
  try {
    return parseR2CacheBucket(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Turns a token's `expires_on` into what the guard should report about it.
 *
 * @param expiresOn The ISO timestamp `/user/tokens/verify` returns, if any.
 * @param now Reference time, for tests.
 * @returns `{ kind }` of `none` (no TTL), `ok`, `expiring`, `expired` or
 *   `unknown`, with `daysLeft` and `expiresOn` where they apply.
 */
export function expiryNotice(expiresOn, now = Date.now()) {
  if (!expiresOn) return { kind: "none" };
  const at = Date.parse(expiresOn);
  if (Number.isNaN(at)) return { kind: "unknown", expiresOn };
  const daysLeft = Math.floor((at - now) / 86_400_000);
  if (at <= now) return { kind: "expired", daysLeft, expiresOn };
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { kind: "expiring", daysLeft, expiresOn };
  return { kind: "ok", daysLeft, expiresOn };
}

/**
 * Classifies the answer to `GET /user/tokens/verify`.
 *
 * @param httpStatus Response status; 0 means the request never completed.
 * @param payload Parsed body, when there was one.
 * @returns `{ status }` of `active`, `rejected`, or `unverifiable` (with `detail`).
 */
export function classifyTokenVerify(httpStatus, payload) {
  const detail = apiErrorDetail(payload, httpStatus);
  const result = payload?.result;
  if (httpStatus === 200 && payload?.success !== false && result?.status === "active") {
    return { status: "active", detail, id: result.id };
  }
  // A token Cloudflare will not even recognize is the credential's problem, not
  // a scope problem: 401 is what a revoked, expired or edited token answers.
  if (httpStatus === 401 || httpStatus === 403 || (httpStatus === 200 && payload?.success === false)) {
    return { status: "rejected", detail };
  }
  return { status: "unverifiable", detail };
}

/**
 * Classifies the answer to `GET /accounts/:id/r2/buckets/:name`.
 *
 * @param httpStatus Response status; 0 means the request never completed.
 * @param payload Parsed body, when there was one.
 * @returns One of `ok`, `missing`, `unauthenticated`, `denied`, `unknown` or
 *   `error`.
 */
export function classifyBucketLookup(httpStatus, payload) {
  if (httpStatus === 200 && payload?.success !== false) return "ok";
  if (httpStatus === 401) return "unauthenticated";
  if (httpStatus === 403) return "denied";
  if (httpStatus === 404) return "missing";
  if (httpStatus === 0 || httpStatus >= 500) return "unknown";
  return "error";
}

/**
 * Renders Cloudflare's error array as one readable clause.
 *
 * @param payload Parsed API body.
 * @param httpStatus Status to fall back on.
 * @returns e.g. `Authentication error (code 10000)` or `HTTP 404`.
 */
export function apiErrorDetail(payload, httpStatus) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const rendered = errors
    .map((error) => {
      const message = typeof error?.message === "string" ? error.message : "";
      const code = error?.code;
      if (message && code !== undefined) return `${message} (code ${code})`;
      if (message) return message;
      return code !== undefined ? `code ${code}` : "";
    })
    .filter(Boolean);
  if (rendered.length) return rendered.join("; ");
  return `HTTP ${httpStatus}`;
}

/** The repository secret both workflows read this value from. */
const TOKEN_SECRET = "CLOUDFLARE_API_TOKEN";
/** How the message tells the operator to fix a credential problem. */
const ROTATE_HINT =
  "Rotate it in the Cloudflare dashboard (My Profile → API Tokens) and update the repository secret " +
  "(Settings → Secrets and variables → Actions). An unrenewed TTL, a revoked token and one that was " +
  "replaced by a value with a stray newline all look exactly like this.";

/**
 * Issues one authenticated GET against the Cloudflare API.
 *
 * @returns `{ status, payload }`; `status` is 0 when the request never landed.
 */
async function cloudflareGet(fetchImpl, url, token) {
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A non-JSON body (an HTML challenge, an empty 502) is classified by status.
    }
    return { status: response.status, payload };
  } catch {
    return { status: 0, payload: null };
  }
}

/**
 * Checks that the Cloudflare credential can do what the deploy needs.
 *
 * @param options.env Environment to read the two credentials from.
 * @param options.fetchImpl Injected for tests.
 * @param options.bucketName Resolved bucket to check; null skips that check.
 * @param options.now Reference time for the expiry notice, for tests.
 * @returns `{ ok, exitCode, lines }` where each line is `{ level, text }` and
 *   `level` is `ok`, `warn` or `fail`. The token is never part of any line.
 */
export async function checkCloudflareCredentials({
  env = {},
  fetchImpl = globalThis.fetch,
  bucketName = readR2CacheBucket(),
  now = Date.now(),
} = {}) {
  const lines = [];
  const ok = (text) => lines.push({ level: "ok", text });
  const warn = (text) => lines.push({ level: "warn", text });
  const fail = (text) => lines.push({ level: "fail", text });

  const token = String(env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();

  if (!token) {
    fail(
      `${TOKEN_SECRET} is not set. Both deploy workflows read it from the repository secret of the ` +
        `same name (Settings → Secrets and variables → Actions). Pull requests from forks never ` +
        `receive repository secrets, so a preview deploy of a fork cannot authenticate at all.`,
    );
  }
  if (!accountId) {
    fail(
      "CLOUDFLARE_ACCOUNT_ID is not set. It belongs in the same repository secrets as " +
        `${TOKEN_SECRET}.`,
    );
  }
  if (lines.some((line) => line.level === "fail")) {
    return { ok: false, exitCode: 1, lines };
  }

  // 1. Is the credential itself alive? This endpoint needs no permission, so a
  //    rejection here can only be about the token.
  const verify = await cloudflareGet(fetchImpl, `${API_BASE}/user/tokens/verify`, token);
  const tokenState = classifyTokenVerify(verify.status, verify.payload);
  if (tokenState.status === "rejected") {
    fail(`Cloudflare rejected ${TOKEN_SECRET}: ${tokenState.detail}. ${ROTATE_HINT}`);
    return { ok: false, exitCode: 1, lines };
  }
  if (tokenState.status === "unverifiable") {
    warn(
      `Could not verify ${TOKEN_SECRET} (${tokenState.detail}); continuing — the deploy will report ` +
        `Cloudflare's own error if the credential is in fact unusable.`,
    );
  } else {
    ok(`${TOKEN_SECRET} is active${tokenState.id ? ` (id ${tokenState.id})` : ""}.`);
  }

  // 2. A TTL that is about to run out fails every Cloudflare call in this
  //    workflow the day it lapses, with nothing here to explain it.
  const expiry = expiryNotice(verify.payload?.result?.expires_on, now);
  if (expiry.kind === "expired") {
    fail(`${TOKEN_SECRET} expired on ${expiry.expiresOn}. ${ROTATE_HINT}`);
  } else if (expiry.kind === "expiring") {
    warn(
      `${TOKEN_SECRET} expires in ${expiry.daysLeft} day(s), on ${expiry.expiresOn}. Rotate it before ` +
        `then: an expired token fails every Cloudflare call in this workflow, and OpenNext reports it ` +
        `as a failed R2 bucket provisioning rather than as an auth error.`,
    );
  } else if (expiry.kind === "ok") {
    ok(`${TOKEN_SECRET} expires on ${expiry.expiresOn} (${expiry.daysLeft} days away).`);
  } else if (expiry.kind === "unknown") {
    warn(`${TOKEN_SECRET} reports an unreadable expiry ("${expiry.expiresOn}"); verify it by hand.`);
  } else {
    ok(`${TOKEN_SECRET} has no expiry date.`);
  }

  // 3. The bucket the web deploy provisions. Exactly the call OpenNext makes
  //    before publishing, so a scope gap fails here instead of mid-deploy.
  if (!bucketName) {
    warn(
      `No ${R2_CACHE_BINDING} R2 binding in apps/web/wrangler.toml — skipping the bucket check. ` +
        `The web deploy provisions the incremental cache through it when one is declared.`,
    );
    return { ok: !lines.some((line) => line.level === "fail"), exitCode: 0, lines };
  }

  const lookup = await cloudflareGet(
    fetchImpl,
    `${API_BASE}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}`,
    token,
  );
  const detail = apiErrorDetail(lookup.payload, lookup.status);
  switch (classifyBucketLookup(lookup.status, lookup.payload)) {
    case "ok":
      ok(`R2 bucket "${bucketName}" (${R2_CACHE_BINDING}) exists and is readable.`);
      break;
    case "missing":
      fail(
        `R2 bucket "${bucketName}" does not exist (${detail}). Create it once — ` +
          `npx wrangler r2 bucket create ${bucketName} — or point ${R2_CACHE_BINDING} at the right ` +
          `bucket in apps/web/wrangler.toml. If the bucket does exist, the account is the problem: ` +
          `CLOUDFLARE_ACCOUNT_ID must be the account the token belongs to.`,
      );
      break;
    case "unauthenticated":
      fail(`Cloudflare rejected ${TOKEN_SECRET} while checking R2 bucket "${bucketName}": ${detail}. ${ROTATE_HINT}`);
      break;
    case "denied":
      fail(
        `${TOKEN_SECRET} cannot read R2 bucket "${bucketName}": ${detail}. The web deploy needs the ` +
          `"Workers R2 Storage: Edit" permission on the token — opennextjs-cloudflare deploy checks ` +
          `(and, when missing, creates) that bucket before it publishes, so without it the deploy ` +
          `aborts with "Failed to provision remote R2 bucket".`,
      );
      break;
    case "unknown":
      warn(
        `Could not check R2 bucket "${bucketName}" (${detail}); continuing — the deploy will report ` +
          `Cloudflare's own error if the bucket is unreachable.`,
      );
      break;
    default:
      fail(`R2 bucket "${bucketName}" could not be checked: ${detail}.`);
      break;
  }

  const failed = lines.some((line) => line.level === "fail");
  return { ok: !failed, exitCode: failed ? 1 : 0, lines };
}

async function main() {
  const startedAt = Date.now();
  const { exitCode, lines } = await checkCloudflareCredentials({
    env: process.env,
    fetchImpl: globalThis.fetch,
    bucketName: readR2CacheBucket(),
  });

  for (const line of lines) {
    const prefix = line.level === "fail" ? "  FAIL " : line.level === "warn" ? "  warn " : "  ok   ";
    (line.level === "fail" ? console.error : console.log)(`${prefix}${line.text}`);
  }

  if (exitCode === 0) {
    console.log(`Cloudflare credentials verified in ${Date.now() - startedAt}ms.`);
  } else {
    console.error(
      "Cloudflare credential check FAILED. This is a repository secret, not application code: " +
        "nothing in this pipeline can deploy until the credential above is fixed.",
    );
  }
  process.exitCode = exitCode;
}

// Only run when invoked directly, so the helpers above stay importable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Cloudflare credential check FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
