#!/usr/bin/env node

/**
 * Preflight guard for the FCM service account Android chat pushes depend on.
 *
 * WHY THIS EXISTS
 *   Android chat notifications are drawn by the app itself: the server sends
 *   chat messages to the device's raw FCM token as data-only messages, and
 *   apps/web/lib/push/{chat,direct-message,activity}.ts fall back to the Expo
 *   transport whenever `isFcmConfigured()` is false. Expo's notification cannot
 *   put the community DP or the sender's photo in the avatar slot, so a service
 *   account that is missing, malformed, from another Firebase project, or
 *   revoked does not break push — it silently turns every notification back
 *   into the generic app icon, and nothing in the logs says so.
 *
 *   Every one of those states is a reproducible answer from Google, so the
 *   deploy can ask before it ships:
 *
 *     "$FCM_SERVICE_ACCOUNT"  --JSON-->  project_id / client_email / private key
 *                             --RS256--> JWT assertion
 *                             --POST-->  https://oauth2.googleapis.com/token
 *
 *   A 200 with an access token proves the key parses, the JWT is signed with
 *   the right algorithm, the service account is still enabled, and the
 *   firebase.messaging scope is granted — the exact chain the Worker runs on
 *   every chat message.
 *
 * WHAT IT ALSO CATCHES
 *   1. Double-escaped keys. The secret is the service-account *file* as one
 *      string. Pasted once, `\n` inside the JSON is an escape and parses into
 *      real newlines; pasted as an already-escaped string, the key keeps
 *      literal backslash-n sequences and every signature fails at runtime.
 *      Here it is a named error instead.
 *   2. A different Firebase project. The app's google-services.json (committed
 *      at expo-app-standalone 3/google-services.json) names the project the
 *      device tokens belong to. A service account from another project can
 *      mint tokens all day and still be told UNREGISTERED for every device.
 *
 * WHERE THE VALUE COMES FROM
 *   `process.env.FCM_SERVICE_ACCOUNT` — what the deploy workflow passes from the
 *   repository secret, i.e. the exact value it is about to push to the Worker.
 *   Locally the same variable can be exported (or placed in apps/web/.env.local)
 *   to check the credential before a manual `wrangler secret put`.
 *
 * WHAT FAILS THE RUN
 *   Only deterministic answers: unset, unparsable, missing fields, a literal
 *   backslash in the key, a project mismatch, or Google refusing the credential
 *   (4xx). A 5xx or a network error is reported as a warning and the pipeline
 *   continues — this guard exists to catch a dead credential, not to become a
 *   new way for a healthy deploy to go red (same rule as
 *   scripts/verify-r2-credentials.mjs).
 *
 *   Nothing secret is ever printed: the client email is shown masked and the
 *   private key is never logged, not even its length.
 *
 * USAGE
 *   node scripts/verify-fcm-credentials.mjs
 *   npm run verify:fcm
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** The app whose device tokens these messages are addressed to. */
export const GOOGLE_SERVICES_PATH = join(
  REPO_ROOT,
  "expo-app-standalone 3",
  "google-services.json",
);

/** The workflow that pushes this secret onto the Worker. */
export const DEPLOY_WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "deploy.yml");

/** Scope the Worker's miner requests; FCM v1 needs exactly this one. */
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/** Shown in logs instead of the service account's identity. */
export function maskEmail(email) {
  if (typeof email !== "string" || email.length === 0) return "(none)";
  const at = email.indexOf("@");
  if (at <= 0) return "…";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}…@${domain}`;
}

/**
 * Parses the secret. Returns `{ account }` or `{ error }` with a message that
 * names what to fix — never the value.
 */
export function parseServiceAccount(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      error:
        "FCM_SERVICE_ACCOUNT is not set. Add the Firebase service-account JSON as a repository secret.",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      error:
        "FCM_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account file, in one line, without quotes around it.",
    };
  }

  const projectId = typeof parsed?.project_id === "string" ? parsed.project_id.trim() : "";
  const clientEmail = typeof parsed?.client_email === "string" ? parsed.client_email.trim() : "";
  const privateKey = typeof parsed?.private_key === "string" ? parsed.private_key : "";

  const missing = [
    !projectId ? "project_id" : null,
    !clientEmail ? "client_email" : null,
    !privateKey ? "private_key" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    return {
      error: `FCM_SERVICE_ACCOUNT is missing ${missing.join(", ")}. Use the service-account key file as Google downloaded it.`,
    };
  }

  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
    return {
      error:
        "FCM_SERVICE_ACCOUNT's private_key is not a PEM block. Re-download the key file; do not trim or re-wrap it.",
    };
  }

  // A real newline is fine; a literal backslash-n means the value was escaped
  // twice, which the Worker's JSON.parse turns into PEM text it cannot decode.
  if (privateKey.includes("\\n")) {
    return {
      error:
        "FCM_SERVICE_ACCOUNT's private_key contains literal \\n sequences (the JSON was escaped twice). Paste the raw key file contents as the secret.",
    };
  }

  return {
    account: {
      projectId,
      clientEmail,
      privateKey,
      tokenUri: typeof parsed?.token_uri === "string" ? parsed.token_uri : DEFAULT_TOKEN_URI,
    },
  };
}

/** The Firebase project the installed app's device tokens belong to. */
export function readAppProjectId(path = GOOGLE_SERVICES_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const id = parsed?.project_info?.project_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * The push step has to hand the JSON to wrangler through `env:`, never through
 * `${{ }}` inside the shell command.
 *
 * GitHub interpolates the secret into the script TEXT before bash parses it,
 * so `printf '%s' "${{ secrets.FCM_SERVICE_ACCOUNT }}"` gave bash a JSON
 * document wrapped in double quotes: bash removed every inner quote and the
 * Worker stored `{ project_id: uxcommunity, ... }` — not JSON. `JSON.parse`
 * then failed at runtime, `isFcmConfigured()` was false, and every Android chat
 * push silently fell back to Expo's layout with the app icon where the DP
 * belongs. No error was raised anywhere; the only symptom was the missing
 * avatar.
 *
 * Returns the offending lines (empty when the push is safe).
 */
export function findInterpolatedSecretPush(workflowText) {
  if (typeof workflowText !== "string") return [];
  return workflowText
    .split("\n")
    .filter((line) => line.includes("wrangler secret put FCM_SERVICE_ACCOUNT"))
    .filter((line) => line.includes("${{"))
    .map((line) => line.trim());
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The signed JWT assertion Google exchanges for an access token. */
export function buildAssertion(account, nowSeconds) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: FCM_SCOPE,
      aud: account.tokenUri ?? DEFAULT_TOKEN_URI,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(account.privateKey));
  return `${header}.${claims}.${signature}`;
}

/**
 * Runs the whole check. `fetchImpl` and `now` are injected so the branches are
 * testable without a network or a real key.
 *
 * Returns `{ ok: true }`, `{ ok: true, warning }` or `{ ok: false, error }`.
 */
export async function checkFcmCredentials({
  raw,
  appProjectId,
  fetchImpl = globalThis.fetch,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const parsed = parseServiceAccount(raw);
  if (parsed.error) return { ok: false, error: parsed.error };
  const { account } = parsed;

  if (appProjectId && appProjectId !== account.projectId) {
    return {
      ok: false,
      error:
        `FCM_SERVICE_ACCOUNT belongs to Firebase project "${account.projectId}", ` +
        `but the app registers tokens for "${appProjectId}". Every send would be ` +
        "rejected as an unknown token — download the key from the app's own project.",
    };
  }

  let assertion;
  try {
    assertion = buildAssertion(account, now());
  } catch {
    return {
      ok: false,
      error:
        "FCM_SERVICE_ACCOUNT's private key could not sign the JWT. Re-download the key file and replace the secret.",
    };
  }

  let response;
  try {
    response = await fetchImpl(account.tokenUri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch {
    return {
      ok: true,
      warning:
        "Could not reach Google's token endpoint, so the FCM credential was not checked. Re-run the deploy once the network is healthy.",
    };
  }

  if (response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload?.access_token) {
      return {
        ok: false,
        error:
          "Google accepted the assertion but returned no access token. Check that the Firebase Messaging API is enabled for the project.",
      };
    }
    return { ok: true, projectId: account.projectId, clientEmail: account.clientEmail };
  }

  if (response.status >= 500) {
    return {
      ok: true,
      warning: `Google's token endpoint answered ${response.status}; the FCM credential was not checked this run.`,
    };
  }

  let detail = "";
  try {
    const body = await response.json();
    detail = typeof body?.error === "string" ? ` (${body.error})` : "";
  } catch {
    detail = "";
  }
  return {
    ok: false,
    error:
      `Google rejected FCM_SERVICE_ACCOUNT${detail} with HTTP ${response.status}. ` +
      "The key was revoked, rotated, or the service account was disabled — download a new key and update the secret.",
  };
}

async function main() {
  // The push step is checked first: a valid key that the shell mangles on the
  // way to the Worker fails exactly like a dead one, only silently.
  let workflow = "";
  try {
    workflow = readFileSync(DEPLOY_WORKFLOW_PATH, "utf8");
  } catch {
    workflow = "";
  }
  const unsafePush = findInterpolatedSecretPush(workflow);
  if (unsafePush.length > 0) {
    console.error(
      "::error::The deploy workflow interpolates FCM_SERVICE_ACCOUNT into the shell, which strips the JSON's quotes and breaks the credential silently. Pass it through `env:` instead.\n" +
        unsafePush.join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const appProjectId = readAppProjectId();
  const result = await checkFcmCredentials({
    raw: process.env.FCM_SERVICE_ACCOUNT,
    appProjectId,
  });

  if (!result.ok) {
    console.error(`::error::${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (result.warning) {
    console.warn(`::warning::${result.warning}`);
  }
  if (result.projectId) {
    console.log(
      `FCM credential OK — ${maskEmail(result.clientEmail)} can mint tokens for project "${result.projectId}"` +
        (appProjectId ? ` (app: "${appProjectId}")` : ""),
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("verify-fcm-credentials.mjs")) {
  await main();
}
