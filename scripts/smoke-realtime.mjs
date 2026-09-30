#!/usr/bin/env node

/**
 * Post-deploy smoke test for the realtime Worker.
 *
 * WHY THIS EXISTS
 *   A deploy could be green while the product's realtime layer was dead. The
 *   Worker answered `/publish` with "ok", CI reported success, and every browser
 *   in the app got a refused WebSocket handshake — because the secrets were
 *   staged into a version that was never published (see the `Set realtime worker
 *   secrets` step in .github/workflows/deploy.yml). Nothing in the pipeline
 *   asked the deployed Worker to do the one thing it exists for. This does.
 *
 * WHAT IT PROVES — against a DEPLOYED origin, over the same public surface a
 * browser uses:
 *   1. an unauthenticated upgrade is refused with 401, which also means the new
 *      version is the one answering (and that auth is not accidentally off);
 *   2. an authenticated upgrade completes (101 → `open`);
 *   3. the `join` frame is acknowledged with a `hello`, so the JWT verified and
 *      the right Durable Object wired the socket;
 *   4. the socket's subscription shows up in that Durable Object's own index;
 *   5. a secret-authenticated `POST /publish` is delivered back over the socket
 *      as an `event` frame — the whole path a notification or chat message takes.
 *
 *   It uses a SENTINEL user and a fixed instance name on purpose: the test does
 *   not touch a real member's state, and reusing one instance means the check
 *   does not mint a new Durable Object on every deploy.
 *
 * WHY THE TOKEN TRAVELS IN THE QUERY, NOT A COOKIE
 *   The browser authenticates the handshake with the `uxcommunity_session`
 *   cookie, which the Worker also accepts. Node's standard WebSocket API cannot
 *   set request headers, and the Worker's `?token=` fallback runs the identical
 *   verification path: same JWT, same secret, same routing, same 101. The cookie
 *   itself is a browser concern and cannot be exercised from CI. The token is
 *   short-lived (see TOKEN_TTL_SECONDS) because it does land in the Worker's
 *   invocation logs.
 *
 * USAGE
 *   node scripts/smoke-realtime.mjs --url https://rt.uxcommunity.in
 *   npm run smoke:realtime -- --url http://localhost:8787
 *
 *   SESSION_SECRET and REALTIME_PUBLISH_SECRET come from the environment; when
 *   either is missing they are read from apps/realtime/.dev.vars, so the same
 *   command works against a local `wrangler dev`.
 *
 * EXIT CODE
 *   1 when any check fails, 0 when the path is proven. CI blocks on it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SignJWT } from "jose";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_VARS_PATH = path.join(ROOT, "apps", "realtime", ".dev.vars");

/** Stable identity for the probe — never a real member. */
export const SENTINEL_USER_ID = "00000000-0000-0000-0000-0000000000ff";
/** The logical room the socket subscribes to; the Worker routes it to UserDO. */
export const LOGICAL_ROOM_PREFIX = "notifications:";
/** Short enough that a leaked URL token is useless almost immediately. */
export const TOKEN_TTL_SECONDS = 120;

const OPEN_TIMEOUT_MS = 10_000;
const FRAME_TIMEOUT_MS = 10_000;
const STATS_TIMEOUT_MS = 10_000;
const PREFLIGHT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 2;
const POLL_INTERVAL_MS = 100;

// ── Pure helpers (unit-tested in scripts/smoke-realtime.test.mjs) ────────────

/**
 * Normalize a realtime origin to the `ws://` / `wss://` form the WebSocket
 * constructor needs. Returns null for anything that is not an http(s) origin —
 * a typo in the origin must fail loudly, not probe somewhere unexpected.
 */
export function toWebSocketOrigin(origin) {
  if (typeof origin !== "string") return null;
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

/**
 * Minimal `.dev.vars` parser for local runs: `KEY=value` per line, optional
 * surrounding quotes, `#` comments and blank lines ignored.
 */
export function parseDevVars(contents) {
  const vars = {};
  for (const line of String(contents).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

/**
 * Resolve the two secrets this probe needs, preferring the environment (CI)
 * and falling back to local dev vars. Missing configuration is reported by NAME
 * — never by value.
 */
export function resolveSecrets(env, devVars) {
  const sessionSecret = env.SESSION_SECRET || devVars?.SESSION_SECRET || "";
  const publishSecret = env.REALTIME_PUBLISH_SECRET || devVars?.REALTIME_PUBLISH_SECRET || "";
  const missing = [];
  if (!sessionSecret) missing.push("SESSION_SECRET");
  if (!publishSecret) missing.push("REALTIME_PUBLISH_SECRET");
  return {
    sessionSecret,
    publishSecret,
    missing,
    source: env.SESSION_SECRET && env.REALTIME_PUBLISH_SECRET ? "environment" : "apps/realtime/.dev.vars",
  };
}

/** Mint the same session JWT the web app issues, for the sentinel user. */
export async function buildSmokeToken(sessionSecret, userId = SENTINEL_USER_ID) {
  return new SignJWT({ userId, email: "realtime-smoke@uxcommunity.invalid", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(sessionSecret));
}

/** Parse one server frame; null for anything that is not a JSON object. */
export function parseFrame(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Runtime plumbing ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll `check` until it returns a truthy value or the deadline passes. */
async function waitFor(check, timeoutMs, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await check();
    if (last) return last;
    if (Date.now() >= deadline) throw new Error(failureMessage);
    await sleep(POLL_INTERVAL_MS);
  }
}

function describeSocketError(event) {
  const message = event?.message || event?.error?.message;
  return message ? String(message) : "no reason reported by the client";
}

/** Resolve on `open`; reject with the reason on `error` / early `close`. */
function openSocket(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`handshake did not complete within ${timeoutMs}ms (readyState=${ws.readyState})`));
    }, timeoutMs);
    const settle = (fn) => (arg) => {
      clearTimeout(timer);
      fn(arg);
    };
    ws.addEventListener("open", settle(() => resolve()), { once: true });
    ws.addEventListener(
      "error",
      settle((event) => reject(new Error(`handshake failed: ${describeSocketError(event)}`))),
      { once: true },
    );
    ws.addEventListener(
      "close",
      settle((event) => reject(new Error(`socket closed before it opened (code ${event.code})`))),
      { once: true },
    );
  });
}

/**
 * Explain a failed handshake. The client's own error carries no reason for a
 * refused upgrade, so ask the Worker directly: a plain HTTP request carrying the
 * SAME token authenticates in `handleUpgrade` exactly like the upgrade does, and
 * a 401 there means the session JWT was rejected (which is what a Worker whose
 * SESSION_SECRET does not match the web app's does to every socket in the app).
 */
async function diagnoseHandshake(httpOrigin, token) {
  const room = `user:${SENTINEL_USER_ID}`;
  const probe = `${httpOrigin}/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(probe, { signal: AbortSignal.timeout(FRAME_TIMEOUT_MS) });
    if (response.status === 401) {
      return "the same token was answered with 401 — the Worker rejected the session JWT (a SESSION_SECRET that does not match the web app's refuses every socket this way)";
    }
    return `the same token was accepted (status ${response.status}), so the token is fine and the failure is in the upgrade itself`;
  } catch (error) {
    return `the Worker could not be reached to diagnose (${error.message})`;
  }
}

/** One HTTP request; throws with the status so a failure reads clearly. */
async function httpGet(url, headers, expected) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FRAME_TIMEOUT_MS) });
  if (expected && response.status !== expected) {
    throw new Error(`GET ${url} answered ${response.status}, expected ${expected}`);
  }
  return response;
}

/**
 * Wait until the deployed origin answers with this Worker's own responses.
 * Right after a deploy a request can land on the previous version (or a
 * propagation race), so this is bounded waiting rather than a single call.
 */
async function awaitDeployedVersion(httpOrigin) {
  const probe = `${httpOrigin}/ws?room=${encodeURIComponent("smoke:preflight")}`;
  let lastFailure = "no response";
  const deadline = Date.now() + PREFLIGHT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await httpGet(probe);
      if (response.status === 401) return;
      lastFailure = `answered ${response.status}, expected 401 for an unauthenticated upgrade`;
    } catch (error) {
      lastFailure = error.message;
    }
    await sleep(1_000);
  }
  throw new Error(`no unauthenticated 401 from ${probe} within ${PREFLIGHT_TIMEOUT_MS}ms (${lastFailure})`);
}

/** The five checks. Throws with a specific message; returns the evidence. */
async function proveRealtimePath({ httpOrigin, wsOrigin, token, publishSecret, report }) {
  const instanceRoom = `user:${SENTINEL_USER_ID}`;
  const logicalRoom = `${LOGICAL_ROOM_PREFIX}${SENTINEL_USER_ID}`;

  const ws = new WebSocket(
    `${wsOrigin}/ws?room=${encodeURIComponent(instanceRoom)}&token=${encodeURIComponent(token)}`,
  );
  const frames = [];
  ws.addEventListener("message", (event) => {
    const frame = parseFrame(event.data);
    if (frame) frames.push(frame);
  });
  ws.addEventListener("error", (event) => {
    frames.push({ t: "__error", message: describeSocketError(event) });
  });

  try {
    try {
      await openSocket(ws, OPEN_TIMEOUT_MS);
    } catch (error) {
      throw new Error(`${error.message} — ${await diagnoseHandshake(httpOrigin, token)}`);
    }
    report("authenticated upgrade completed (101)");

    ws.send(JSON.stringify({ t: "join", user: { id: SENTINEL_USER_ID, name: "realtime smoke", avatar: null } }));
    await waitFor(
      () => frames.find((frame) => frame.t === "hello"),
      FRAME_TIMEOUT_MS,
      "no hello frame after join — the JWT verified but the Durable Object did not acknowledge the socket",
    );
    report("join acknowledged (hello from the user Durable Object)");

    ws.send(JSON.stringify({ t: "subscribe", room: logicalRoom, topic: "insert" }));
    const stats = await waitFor(
      async () => {
        const response = await httpGet(
          `${httpOrigin}/stats?room=${encodeURIComponent(instanceRoom)}`,
          { "x-realtime-publish-secret": publishSecret },
        );
        if (!response.ok) throw new Error(`/stats answered ${response.status}`);
        const body = await response.json();
        return body.subscriptionRefs >= 1 ? body : null;
      },
      STATS_TIMEOUT_MS,
      "the subscription never appeared in the Durable Object's index (/stats stayed at 0)",
    );
    report(`subscription indexed (subscriptionRefs=${stats.subscriptionRefs}, sockets=${stats.sockets})`);

    // A fresh event_id per run: the Durable Object de-duplicates by it, so a
    // reused value would be acknowledged without a second fan-out.
    const marker = crypto.randomUUID();
    const publish = await fetch(`${httpOrigin}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": publishSecret,
      },
      body: JSON.stringify({
        room: logicalRoom,
        topic: "insert",
        data: { smoke: marker },
        event_id: marker,
      }),
      signal: AbortSignal.timeout(FRAME_TIMEOUT_MS),
    });
    if (!publish.ok) throw new Error(`POST /publish answered ${publish.status}`);

    await waitFor(
      () => frames.find((frame) => frame.t === "event" && frame.data?.smoke === marker),
      FRAME_TIMEOUT_MS,
      "the publish was accepted but no event frame arrived on the socket",
    );
    report("published event delivered over the socket");
  } finally {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readDevVarsIfPresent() {
  try {
    return parseDevVars(readFileSync(DEV_VARS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/smoke-realtime.mjs --url <https origin> [--attempts N]");
    return;
  }

  const origin = argValue("--url") || process.env.REALTIME_URL || "";
  const attempts = Number(argValue("--attempts") || DEFAULT_ATTEMPTS);
  const wsOrigin = toWebSocketOrigin(origin);
  if (!wsOrigin) {
    console.error(`✗ --url must be an http(s) origin (got ${JSON.stringify(origin)})`);
    process.exitCode = 1;
    return;
  }
  const httpOrigin = wsOrigin.replace(/^ws/, "http");

  const secrets = resolveSecrets(process.env, readDevVarsIfPresent());
  if (secrets.missing.length) {
    console.error(`✗ missing ${secrets.missing.join(", ")} (environment or apps/realtime/.dev.vars)`);
    process.exitCode = 1;
    return;
  }

  console.log(`Realtime smoke test → ${wsOrigin} (secrets from ${secrets.source})`);
  const token = await buildSmokeToken(secrets.sessionSecret);

  // Fail-closed check first, and as the wait for the new version to answer:
  // an unauthenticated upgrade must never be accepted.
  await awaitDeployedVersion(httpOrigin);
  console.log("  ok   unauthenticated upgrade refused with 401");

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await proveRealtimePath({
        httpOrigin,
        wsOrigin,
        token,
        publishSecret: secrets.publishSecret,
        report: (line) => console.log(`  ok   ${line}`),
      });
      console.log("Realtime smoke test passed.");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.log(`  ...  attempt ${attempt} failed (${error.message}); retrying`);
        await sleep(2_000);
      }
    }
  }

  console.error(`  FAIL ${lastError.message}`);
  console.error(`Realtime smoke test FAILED after ${attempts} attempt(s) against ${wsOrigin}.`);
  process.exitCode = 1;
}

// Only run when invoked directly, so the helpers above stay importable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Realtime smoke test FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
