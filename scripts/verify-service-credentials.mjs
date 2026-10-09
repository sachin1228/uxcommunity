#!/usr/bin/env node

/**
 * Preflight guard for the repository secrets the deploy ships to the Worker.
 *
 * WHY THIS EXISTS
 *   scripts/verify-r2-credentials.mjs exists because an R2 credential died
 *   unnoticed on 2026-10-09 and every upload 500'd for hours. The same question
 *   had never been asked of any OTHER secret: the deploy writes all of them
 *   into .dev.vars, uploads them as Worker secrets, and nothing checks whether
 *   they are still accepted. The audit that followed that outage found exactly
 *   the same blind spot on each one:
 *
 *   - Supabase service-role key — every API route and Server Component reads
 *     through it. Expired or replaced, the whole product 401s, and the first
 *     symptom is a page that will not load.
 *   - Resend API key — password resets and invitations. Nothing surfaces a
 *     failure: the member sees "check your email" and waits forever.
 *   - Upstash REST token — rate limiting, which FAILS OPEN by design (see
 *     apps/web/lib/auth/rate-limit.ts), so a dead token silently disables every
 *     limit instead of breaking a feature.
 *   - GIPHY API key — GIF search only, and it fails closed, so it is the one
 *     that can wait.
 *
 * WHAT IT PROVES, BEFORE THE BUILD
 *   Each service gets one authenticated, read-only request: a Supabase REST
 *   row read, `GET /domains` on Resend (which proves the key without sending
 *   mail), `GET /ping` on the Upstash REST endpoint, and a one-result GIPHY
 *   trending lookup. A rejected credential is reported with the repository
 *   secret to rotate and what breaks while it is dead.
 *
 *   Resend is the one provider that does NOT use 401 for a dead key: the live
 *   API answers 400 with `{"message":"API key is invalid"}` (verified by
 *   probe on 2026-10-09), so the classification reads the body rather than
 *   trusting the status code alone.
 *
 * WHY NOT EVERYTHING FAILS THE DEPLOY
 *   Same rule as the other two guards: this exists to catch a dead credential,
 *   not to become a new way for a healthy deploy to go red. Supabase and Resend
 *   FAIL, because "the app cannot serve" and "password resets silently die" are
 *   not states a deploy should ship into. Upstash and GIPHY WARN: the app keeps
 *   serving without them, so the operator decides. A 5xx or a network error
 *   warns for all four — that is the platform being unhappy, not the secret.
 *
 * WHERE THE VALUES COME FROM
 *   `process.env` first (what both deploy workflows pass from repository
 *   secrets), then the files a local run reads: apps/web/.dev.vars,
 *   apps/web/.env.local, apps/web/.env. `npm run verify:services` therefore
 *   checks exactly what a developer's dev server would use.
 *
 * USAGE
 *   node scripts/verify-service-credentials.mjs
 *   npm run verify:services
 *
 * EXIT CODE
 *   1 when a FAIL-level credential is dead, 0 otherwise. Its helpers are
 *   unit-tested (scripts/verify-service-credentials.test.mjs) so a wrong guard
 *   cannot block a healthy deploy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ENV_FILE_CANDIDATES,
  fingerprint,
  parseEnvFile,
  REQUEST_TIMEOUT_MS,
} from "./verify-r2-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One probe per service. `level` is what a failure means for a deploy:
 * `fail` for the ones whose failure is invisible to users, `warn` for the ones
 * the app survives without.
 */
export const SERVICES = [
  {
    id: "supabase",
    label: "Supabase (service-role key)",
    vars: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    secret: "SUPABASE_SERVICE_ROLE_KEY",
    level: "fail",
    blastRadius:
      "every API route and Server Component reads through this key — a rejected one 401s the whole product",
  },
  {
    id: "resend",
    label: "Resend (transactional email)",
    vars: ["RESEND_API_KEY"],
    secret: "RESEND_API_KEY",
    level: "fail",
    blastRadius:
      "password resets and invitations stop arriving, and nothing in the app reports it",
  },
  {
    id: "upstash",
    label: "Upstash Redis (rate limiting)",
    vars: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    secret: "UPSTASH_REDIS_REST_TOKEN",
    level: "warn",
    blastRadius:
      "the limiter fails open, so every rate limit is silently off while the app keeps serving",
  },
  {
    id: "giphy",
    label: "GIPHY (GIF search)",
    vars: ["GIPHY_API_KEY"],
    secret: "GIPHY_API_KEY",
    level: "warn",
    blastRadius: "GIF and sticker search returns errors; nothing else depends on it",
  },
];

/** The rotate hint every failure line carries. */
const ROTATE_HINT =
  "Rotate it at the provider, then update the repository secret (Settings → Secrets and variables " +
  "→ Actions) AND every local env file — apps/web/.dev.vars, apps/web/.env.local and apps/web/.env " +
  "— because a deploy only pushes what those secrets hold.";

/**
 * Resolves every var the probes need: environment first, then local files.
 *
 * @returns `{ values, sources }`; `sources` names where each value came from.
 */
export function loadServiceEnv({
  env = process.env,
  readFile = (file) => readFileSync(file, "utf8"),
  files = ENV_FILE_CANDIDATES,
} = {}) {
  const values = {};
  const sources = {};
  const wanted = new Set(SERVICES.flatMap((service) => service.vars));

  for (const name of wanted) {
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
      continue; // Missing on a CI runner and not a finding.
    }
    for (const name of wanted) {
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
 * Classifies one probe answer.
 *
 * @param status HTTP status; 0 means the request never completed.
 * @param body Response text. Resend answers a dead key with 400 ("API key is
 *   invalid") instead of 401, so the body is the only reliable signal there;
 *   it is never printed, only tested for that phrase.
 * @returns `pass`, `rejected` (the credential is dead), `misconfigured`
 *   (the endpoint or account is wrong) or `unknown` (5xx / network / limited).
 */
export function classifyProbe(status, body = "") {
  if (status === 0) return "unknown";
  if (status >= 500) return "unknown";
  if (status === 401 || status === 403) return "rejected";
  if (status === 400 && /(api[ _-]?key is invalid|invalid api[ _-]?key)/i.test(body)) return "rejected";
  if (status === 429) return "unknown";
  if (status >= 400) return "misconfigured";
  return "pass";
}

/**
 * Builds the request each service is probed with.
 *
 * @returns `{ url, init }` for the given service and resolved values.
 */
export function probeRequest(service, values) {
  const url = values.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = values.SUPABASE_SERVICE_ROLE_KEY ?? "";

  switch (service.id) {
    case "supabase":
      return {
        url: `${url.replace(/\/$/, "")}/rest/v1/users?select=id&limit=1`,
        init: {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        },
      };
    case "resend":
      return {
        url: "https://api.resend.com/domains",
        init: { headers: { Authorization: `Bearer ${values.RESEND_API_KEY}` } },
      };
    case "upstash":
      return {
        url: `${(values.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "")}/ping`,
        init: { headers: { Authorization: `Bearer ${values.UPSTASH_REDIS_REST_TOKEN}` } },
      };
    case "giphy":
      return {
        url: `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(
          values.GIPHY_API_KEY ?? "",
        )}&limit=1`,
        init: {},
      };
    default:
      throw new Error(`unknown service: ${service.id}`);
  }
}

/**
 * Probes every service and turns the answers into report lines.
 *
 * @returns `{ ok, exitCode, lines }` where each line is `{ level, text }` and
 *   `level` is `ok`, `warn` or `fail`. No line ever contains a secret value.
 */
export async function checkServiceCredentials({
  env = process.env,
  readFile,
  files,
  fetchImpl = globalThis.fetch,
} = {}) {
  const lines = [];
  const ok = (text) => lines.push({ level: "ok", text });
  const warn = (text) => lines.push({ level: "warn", text });
  const fail = (text) => lines.push({ level: "fail", text });

  const { values, sources } = loadServiceEnv({ env, readFile, files });

  for (const service of SERVICES) {
    const missing = service.vars.filter((name) => !values[name]);
    if (missing.length) {
      (service.level === "fail" ? fail : warn)(
        `${service.label}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set — ${
          service.blastRadius
        }. ${ROTATE_HINT}`,
      );
      continue;
    }

    const { url, init } = probeRequest(service, values);
    let status = 0;
    let body = "";
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      status = response.status;
      // The body is kept only long enough to recognise "API key is invalid"
      // (Resend's 400 for a dead key). It is never printed: an error body can
      // echo back part of the credential.
      body = (await response.text().catch(() => "")).slice(0, 400);
    } catch {
      status = 0;
    }

    const verdict = classifyProbe(status, body);
    const from = sources[service.secret] ?? "environment";
    const who = `${fingerprint(values[service.secret])} from ${from}`;

    if (verdict === "pass") {
      ok(`${service.label}: authenticated (${who}).`);
    } else if (verdict === "rejected") {
      (service.level === "fail" ? fail : warn)(
        `${service.label}: ${service.secret} was rejected (HTTP ${status}, key ${who}) — ${
          service.blastRadius
        }. ${ROTATE_HINT}`,
      );
    } else if (verdict === "misconfigured") {
      (service.level === "fail" ? fail : warn)(
        `${service.label}: the endpoint answered HTTP ${status} — check the URL/account for ${
          service.vars[0]
        }, not the secret itself.`,
      );
    } else {
      warn(
        `${service.label}: could not be verified (HTTP ${status || "no response"}); continuing — a ` +
          `dead credential fails loudly here, but a 5xx or a network error must not block a deploy.`,
      );
    }
  }

  const failed = lines.some((line) => line.level === "fail");
  return { ok: !failed, exitCode: failed ? 1 : 0, lines };
}

async function main() {
  const startedAt = Date.now();
  const { exitCode, lines } = await checkServiceCredentials({ env: process.env });

  for (const line of lines) {
    const prefix = line.level === "fail" ? "  FAIL " : line.level === "warn" ? "  warn " : "  ok   ";
    (line.level === "fail" ? console.error : console.log)(`${prefix}${line.text}`);
  }

  if (exitCode === 0) {
    console.log(`Service credentials verified in ${Date.now() - startedAt}ms.`);
  } else {
    console.error(
      "Service credential check FAILED. These are repository secrets, not application code: fix " +
        "the value above before deploying, or the deploy ships a Worker that cannot use that service.",
    );
  }
  process.exitCode = exitCode;
}

// Only run when invoked directly, so the helpers above stay importable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Service credential check FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
