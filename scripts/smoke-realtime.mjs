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
 *      as an `event` frame — the whole path a notification or chat message takes;
 *   6. the membership endpoint the Worker authorizes COMMUNITY sockets against
 *      (`${API_URL}/api/communities/:id/members/:userId/check`, authenticated
 *      with `API_SECRET`) answers what the app answers — `403 {"ok":false}` for a
 *      sentinel non-member — and names the wrong secret when it does not.
 *
 *   Check 6 exists because checks 1-5 all pass while the product is dead: every
 *   room they exercise is USER-scoped, and user rooms skip the membership gate
 *   (see `Room.upgrade`). A membership API that was never reachable from the
 *   Worker — a stale `API_URL`, an `API_SECRET` that does not match the web
 *   app's — therefore refused every community socket in production while this
 *   harness stayed green. It is checked against the SAME two secrets the deploy
 *   just pushed to the Worker, so it fails on the misconfiguration, not on a
 *   copy of it.
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
 *   command works against a local `wrangler dev`. API_URL and API_SECRET are
 *   read the same way; check 6 is skipped (never failed) when the pair is
 *   absent, because a local run may legitimately have no web app to check
 *   against — CI passes both, so it always runs there.
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
/** Sentinel community for the membership probe — never a real community. */
export const SENTINEL_COMMUNITY_ID = "00000000-0000-0000-0000-0000000000cc";
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

/**
 * Resolve the membership configuration this probe needs — the same two values
 * `wrangler secret put API_URL` / `API_SECRET` hand the Worker, preferred from
 * the environment so CI tests the deployed pair. Absent configuration is a
 * legitimate local run, so the caller skips the check rather than failing it.
 */
export function resolveMembershipConfig(env, devVars) {
  const apiUrl = (env.API_URL || devVars?.API_URL || "").trim().replace(/\/+$/, "");
  const apiSecret = env.API_SECRET || devVars?.API_SECRET || "";
  const missing = [];
  if (!apiUrl) missing.push("API_URL");
  if (!apiSecret) missing.push("API_SECRET");
  return { apiUrl, apiSecret, missing };
}

/**
 * The membership URL the Worker itself builds. Returns null for anything that
 * is not an http(s) origin, so a typo in `API_URL` fails loudly here instead of
 * probing somewhere unexpected.
 */
export function membershipProbeUrl(
  apiUrl,
  communityId = SENTINEL_COMMUNITY_ID,
  userId = SENTINEL_USER_ID,
) {
  if (typeof apiUrl !== "string") return null;
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return `${trimmed}/api/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(userId)}/check`;
}

/** Parse a JSON object body; null for anything else (including an HTML page). */
function parseJsonObject(body) {
  try {
    const parsed = JSON.parse(String(body));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Decide what the membership endpoint's answer means, and NAME the wrong secret
 * when it is not the app's answer.
 *
 * The app's own `/check` route sends exactly two things a healthy deploy can
 * see: `200 {"ok":true}` for a member and `403 {"ok":false}` for a non-member
 * (its 401/500 shapes carry an `error` field and mean the caller is wrong, not
 * the user). Everything else is a misconfiguration, and the status says which
 * one: 401 is an `API_SECRET` the app does not recognize, and a 404 — or any
 * non-JSON body, which is what a stale Vercel host or another Worker on the
 * same domain answers — is an `API_URL` that is not the app.
 */
export function classifyMembershipProbe({ status, contentType = "", body = "" }) {
  const json = parseJsonObject(body);
  if (status === 200 && json?.ok === true) {
    return { ok: true, message: "membership API accepted the deployed API_SECRET" };
  }
  if (status === 403 && json && json.ok === false && json.error === undefined) {
    return {
      ok: true,
      message: "membership API reachable and API_SECRET accepted (sentinel correctly treated as a non-member)",
    };
  }
  if (status === 401) {
    return {
      ok: false,
      message:
        "401 unauthorized — the Worker's API_SECRET is not the web app's, so every community socket is refused (fix the API_SECRET GitHub secret, then redeploy the realtime worker)",
    };
  }
  if (json === null || status === 404) {
    return {
      ok: false,
      message: `${status} ${json === null ? "without a JSON body" : "at this path"} (content-type ${JSON.stringify(contentType || "none")}) — API_URL does not point at the app: a stale deployment (the old Vercel host, another Worker) answers here, so the membership check can never authorize (set the API_URL GitHub secret to the app origin)`,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      message: `${status} ${json?.error ?? "internal error"} — the app could not answer the membership check; see the web app's logs`,
    };
  }
  return {
    ok: false,
    message: `${status} ${json?.error ?? "unexpected answer"} — the membership API answered something the app never sends`,
  };
}

/**
 * Prove the deploy can authorize a COMMUNITY socket, the check the harness was
 * missing: it calls the membership endpoint with the same URL and secret the
 * Worker was just given, using a sentinel community and user, and requires the
 * app's own non-member answer. A wrong `API_URL` or `API_SECRET` cannot pass.
 */
async function proveMembershipEndpoint({ apiUrl, apiSecret, report }) {
  const url = membershipProbeUrl(apiUrl);
  if (!url) {
    throw new Error(`API_URL is not an http(s) origin (${JSON.stringify(apiUrl)}), so the Worker cannot check membership at all`);
  }

  let response;
  let body = "";
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiSecret}` },
      redirect: "follow",
      signal: AbortSignal.timeout(FRAME_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    throw new Error(
      `the membership endpoint could not be reached at ${new URL(url).host} (${error.message}) — with an unreachable API_URL the Worker refuses every community socket`,
    );
  }

  const verdict = classifyMembershipProbe({
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body,
  });
  if (!verdict.ok) throw new Error(verdict.message);
  report(verdict.message);
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
    console.log("  Env: SESSION_SECRET, REALTIME_PUBLISH_SECRET (required), API_URL, API_SECRET (community-socket check)");
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

  const devVars = readDevVarsIfPresent();
  const secrets = resolveSecrets(process.env, devVars);
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

  // The version just published is the one answering. Before proving the socket
  // path, prove the layer every USER-scoped check above skips: community rooms
  // are authorized against API_URL/API_SECRET, so a wrong pair there refuses
  // every community socket in the product while everything else stays green.
  const membership = resolveMembershipConfig(process.env, devVars);
  if (membership.missing.length) {
    console.log(
      `  skip membership endpoint check (no ${membership.missing.join(", ")} in the environment or apps/realtime/.dev.vars)`,
    );
  } else {
    await proveMembershipEndpoint({
      apiUrl: membership.apiUrl,
      apiSecret: membership.apiSecret,
      report: (line) => console.log(`  ok   ${line}`),
    });
  }

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
