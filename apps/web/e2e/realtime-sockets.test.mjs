#!/usr/bin/env node

/**
 * End-to-end realtime test: what the BROWSER actually does with the sockets.
 *
 * WHY THIS EXISTS
 *   Every other realtime check in this repository tests one side of the wire.
 *   `scripts/smoke-realtime.mjs` proves the Worker accepts a handshake, the
 *   client's unit tests prove the ref-counting bookkeeping, and neither can see
 *   the thing that actually broke in production and in the dev console: sockets
 *   that are never authorized, are cancelled halfway through the handshake, or
 *   are torn down by a component that did not own them. Those failures live in
 *   the gap between a correct client and a correct Worker — the cookie on the
 *   handshake, how many sockets a page opens, and whether they stay up.
 *
 *   So this drives a real Chrome through the real dashboard and reads the
 *   network layer through the Chrome DevTools Protocol, the same view a
 *   developer has in Network → WS:
 *
 *     Network.webSocketCreated                    → which rooms the page opens
 *     Network.webSocketWillSendHandshakeRequest   → the handshake request
 *     Network.webSocketHandshakeResponseReceived  → the 101 (or its absence)
 *     Network.webSocketFrameError / …Closed       → refusals and teardown
 *
 * A NOTE ON READING THE COOKIE FROM THE DEVTOOLS PROTOCOL
 *   Chrome does NOT expose the `Cookie` header on `webSocketWillSendHandshakeRequest`
 *   for a cross-origin handshake (it does for same-origin ones), so "no Cookie in
 *   the CDP event" is NOT evidence that the cookie went missing — this test was
 *   born from that false alarm. The cookie's real arrival is therefore proven the
 *   only way that cannot lie: the Durable Object that owns `user:${userId}` is
 *   asked, over `/stats`, whether it holds a live socket — and the socket URL
 *   carries no `token`, so a socket it accepted can only have been authorized by
 *   the cookie. The CDP header is still asserted when Chrome does provide it.
 *
 * ASSERTED ALWAYS
 *   - the session is accepted (no redirect to /login);
 *   - at least one realtime handshake is attempted (realtime is wired at all);
 *   - no socket URL carries a `token` query parameter (audit M-7: a session
 *     credential in a URL is logged by every intermediary on the way);
 *   - the session cookie is what authenticates the socket — the user's own
 *     Durable Object holds the socket, and a stranger's holds none;
 *   - no handshake is refused, and
 *   - every room that was attempted ends with a live, 101 socket;
 *   - the user-scoped socket is keyed `user:${userId}` — never the
 *     `user:global` placeholder, which belongs to a Durable Object the server
 *     never publishes to.
 *
 * ASSERTED IN --strict (a production build / deployed target)
 *   - every handshake completed: nothing is cancelled mid-connect;
 *   - each room opens exactly ONE socket;
 *   - no socket that opened is later closed;
 *   - the browser console contains no failed-WebSocket message.
 *
 *   Those four need `--strict` because `next dev` runs React StrictMode
 *   (reactStrictMode: true in next.config.js), whose deliberate
 *   mount → unmount → mount cancels one in-flight handshake per community room:
 *   the client closing a socket it has not finished opening is what StrictMode
 *   is testing for, and it cannot happen in a production build. (User-scoped
 *   sockets survive it by design — a room teardown never closes them — which is
 *   why a community-less session shows no churn at all.)
 *
 * SESSION (first source that is configured wins)
 *   1. E2E_SESSION_COOKIE — a `uxcommunity_session` value you already have
 *      (DevTools → Application → Cookies). Works against any target, local or
 *      deployed, and needs no secrets or database access.
 *   2. E2E_EMAIL + E2E_PASSWORD — signs in through `POST /api/auth/login`, so
 *      the real login path produces the cookie under test. Use an account that
 *      belongs to at least one community to cover the chat rooms too.
 *   3. SESSION_SECRET (+ optional E2E_USER_ID) — mints the same JWT the web app
 *      issues, read from the environment or `apps/web/.dev.vars`. This proves
 *      the client's socket lifecycle (identity, cookie, one socket, no churn)
 *      without touching the database; a community-less dashboard simply has
 *      fewer rooms.
 *
 * USAGE
 *   npm run test:e2e-realtime
 *   npm run test:e2e-realtime -- --path /dashboard/communities/<id> --strict
 *
 *   Run the file directly (as the npm script does) and the flags above work;
 *   `node --test <file>` swallows extra arguments, so configure that form with
 *   the E2E_* environment variables instead.
 *
 *   Requires the app (default http://localhost:3000) and the realtime Worker
 *   (default http://localhost:8787). Chromium comes from the system Chrome via
 *   `channel: "chrome"`; without one, run `npx playwright install chromium`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeJwt } from "jose";
import { chromium } from "playwright";

import { buildSmokeToken, parseDevVars, SENTINEL_USER_ID } from "../../../scripts/smoke-realtime.mjs";

const SESSION_COOKIE = "uxcommunity_session";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DEV_VARS = path.resolve(HERE, "..", ".dev.vars");
const RT_DEV_VARS = path.resolve(HERE, "..", "..", "..", "apps", "realtime", ".dev.vars");

/**
 * Chrome's own wording when a socket is closed before its handshake finished —
 * what StrictMode's simulated unmount does to an in-flight connect. Anything
 * else in a frame error is a real refusal (an unauthorized handshake reports
 * "HTTP Authentication failed; no valid credentials available").
 */
const CANCELLED_HANDSHAKE = /closed before the connection is established/i;

// ── Configuration (flags win over environment) ──────────────────────────────

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const STRICT = process.argv.includes("--strict") || process.env.E2E_STRICT === "1";
const APP_URL = (argValue("--url") ?? process.env.E2E_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const PAGE_PATH = argValue("--path") ?? process.env.E2E_PATH ?? "/dashboard";
const EXPECTED_REALTIME_ORIGIN = (argValue("--realtime-url") ?? process.env.E2E_REALTIME_URL ?? "")
  .replace(/\/+$/, "")
  .replace(/^http/, "ws");
const SETTLE_MS = Number(argValue("--settle-ms") ?? process.env.E2E_SETTLE_MS ?? 2_500);
const TIMEOUT_MS = Number(argValue("--timeout-ms") ?? process.env.E2E_TIMEOUT_MS ?? 60_000);
const REQUIRE_COMMUNITY_SOCKETS =
  process.argv.includes("--require-community-sockets") || process.env.E2E_REQUIRE_COMMUNITY_SOCKETS === "1";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function readDevVars(file) {
  try {
    return parseDevVars(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

// ── Session ─────────────────────────────────────────────────────────────────

/** Sign in through the app's own API; returns the session cookie value. */
async function loginForCookie() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) return null;

  const response = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `POST /api/auth/login answered ${response.status} for ${email}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((header) => header.split(";")[0])
    .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error("POST /api/auth/login set no uxcommunity_session cookie");
  return cookie.slice(SESSION_COOKIE.length + 1);
}

/** Resolve the session under test, plus the user id it belongs to. */
async function resolveSession() {
  if (process.env.E2E_SESSION_COOKIE) {
    return { cookie: process.env.E2E_SESSION_COOKIE.trim(), source: "E2E_SESSION_COOKIE" };
  }

  const loggedIn = await loginForCookie();
  if (loggedIn) return { cookie: loggedIn, source: "POST /api/auth/login" };

  const devVars = readDevVars(WEB_DEV_VARS);
  const secret = process.env.SESSION_SECRET || devVars?.SESSION_SECRET || "";
  if (secret) {
    const userId = process.env.E2E_USER_ID || SENTINEL_USER_ID;
    return {
      cookie: await buildSmokeToken(secret, userId),
      source: process.env.SESSION_SECRET ? "SESSION_SECRET (environment)" : "SESSION_SECRET (apps/web/.dev.vars)",
    };
  }

  throw new Error(
    "no session available: set E2E_SESSION_COOKIE, or E2E_EMAIL + E2E_PASSWORD, or SESSION_SECRET",
  );
}

// ── Collection ──────────────────────────────────────────────────────────────

function headerValue(headers, name) {
  const key = Object.keys(headers ?? {}).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function roomOf(url) {
  try {
    return new URL(url).searchParams.get("room");
  } catch {
    return null;
  }
}

/** Realtime sockets are the Worker's `/ws` route; everything else is dev tooling. */
function isRealtimeSocket(url) {
  try {
    return new URL(url).pathname === "/ws";
  } catch {
    return false;
  }
}

/** Launch a browser, sign in, load the page and record every socket it opens. */
async function collectSockets() {
  const session = await resolveSession();
  let userId;
  try {
    userId = decodeJwt(session.cookie).userId;
  } catch {
    throw new Error("the resolved session cookie is not a JWT — pass a uxcommunity_session value");
  }
  if (typeof userId !== "string" || !userId) userId = null;

  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch((error) => {
    throw new Error(`${error.message}\n  Install a browser for Playwright with: npx playwright install chromium`);
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: SESSION_COOKIE, value: session.cookie, url: new URL("/", APP_URL).href }]);
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");

  /** requestId → observation, joined across the CDP events. */
  const sockets = new Map();
  const record = (requestId) => {
    let entry = sockets.get(requestId);
    if (!entry) {
      entry = { requestId, url: "", cookieHeader: undefined, status: null, closed: false, frameErrors: [] };
      sockets.set(requestId, entry);
    }
    return entry;
  };

  cdp.on("Network.webSocketCreated", ({ requestId, url }) => {
    record(requestId).url = url;
  });
  cdp.on("Network.webSocketWillSendHandshakeRequest", ({ requestId, request }) => {
    record(requestId).cookieHeader = headerValue(request?.headers, "cookie");
  });
  cdp.on("Network.webSocketHandshakeResponseReceived", ({ requestId, response }) => {
    record(requestId).status = response?.status ?? null;
  });
  cdp.on("Network.webSocketFrameError", ({ requestId, errorMessage }) => {
    record(requestId).frameErrors.push(String(errorMessage ?? ""));
  });
  cdp.on("Network.webSocketClosed", ({ requestId }) => {
    record(requestId).closed = true;
  });

  // The console is what a developer actually sees; keep the WebSocket lines so a
  // failure can quote the same message they would have pasted.
  const consoleWsLines = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/websocket/i.test(text)) consoleWsLines.push(text.replace(/\s+/g, " ").trim());
  });

  await page.goto(`${APP_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load").catch(() => {});

  // Wait for the socket set to go quiet: a room opened late (a second sidebar
  // tick, a lazily mounted panel) must still be observed, while a page that opens
  // nothing must not sit silent until the deadline.
  const deadline = Date.now() + TIMEOUT_MS;
  let lastCount = -1;
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    if (sockets.size !== lastCount) {
      lastCount = sockets.size;
      lastChange = Date.now();
    }
    if (lastCount > 0 && Date.now() - lastChange >= SETTLE_MS) break;
    await sleep(100);
  }

  // Ask the Worker what it thinks is connected WHILE the page is still open —
  // both questions are about live sockets, and the browser is closed below.
  const target = realtimeTarget([...sockets.values()]);
  let doView = null;
  let doViewSkipReason = null;
  if (!userId) {
    doViewSkipReason = "this session carries no userId to key a user-scoped socket to";
  } else if (!target) {
    doViewSkipReason = "no realtime socket was opened, so there is nothing to verify";
  } else if (!target.publishSecret) {
    doViewSkipReason = "REALTIME_PUBLISH_SECRET is not configured (environment or apps/realtime/.dev.vars)";
  } else {
    doView = {
      mine: await doStats(target.httpOrigin, target.publishSecret, `user:${userId}`),
      // Control: the same question about a stranger's instance must find nothing,
      // which is what makes the count above evidence of THIS session's cookie.
      stranger: await doStats(target.httpOrigin, target.publishSecret, `user:${crypto.randomUUID()}`),
    };
  }

  const finalUrl = page.url();
  await browser.close();

  return { session, userId, sockets: [...sockets.values()], consoleWsLines, finalUrl, doView, doViewSkipReason };
}

// ── Derived views ───────────────────────────────────────────────────────────

const realtimeSockets = (sockets) => sockets.filter((socket) => isRealtimeSocket(socket.url));

function roomsAttempted(sockets) {
  const counts = new Map();
  for (const socket of realtimeSockets(sockets)) {
    const room = roomOf(socket.url);
    if (room) counts.set(room, (counts.get(room) ?? 0) + 1);
  }
  return counts;
}

function refusalMessages(sockets) {
  return realtimeSockets(sockets)
    .flatMap((socket) => socket.frameErrors)
    .filter((message) => !CANCELLED_HANDSHAKE.test(message));
}

function churnMessages(sockets) {
  return realtimeSockets(sockets).flatMap((socket) => socket.frameErrors).filter((message) => CANCELLED_HANDSHAKE.test(message));
}

/** The Worker origin and publish secret, so the Durable Objects can be asked directly. */
function realtimeTarget(sockets) {
  const first = realtimeSockets(sockets)[0];
  if (!first) return null;
  try {
    const url = new URL(first.url);
    const devVars = readDevVars(RT_DEV_VARS);
    return {
      httpOrigin: `${url.protocol === "wss:" ? "https" : "http"}://${url.host}`,
      publishSecret: process.env.REALTIME_PUBLISH_SECRET || devVars?.REALTIME_PUBLISH_SECRET || "",
    };
  } catch {
    return null;
  }
}

/**
 * Ask one Durable Object how many sockets it holds. This is the Worker's own
 * accounting — nothing the browser claims can fake it.
 */
async function doStats(httpOrigin, publishSecret, room) {
  const response = await fetch(`${httpOrigin}/stats?room=${encodeURIComponent(room)}`, {
    headers: { "x-realtime-publish-secret": publishSecret },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GET /stats for ${room} answered ${response.status}`);
  return response.json();
}

// ── Reporting ───────────────────────────────────────────────────────────────

function describeSocket(socket) {
  const realtime = isRealtimeSocket(socket.url);
  const label = realtime ? roomOf(socket.url) ?? socket.url : `${socket.url} (dev tooling)`;
  const state = socket.status === 101 ? "101 open" : socket.status ? `status ${socket.status}` : "no response";
  const ended = socket.closed ? (socket.status === 101 ? "closed later" : "closed unopened") : "still open";
  const reported = socket.cookieHeader;
  const cookie = reported === undefined ? "cookie not exposed by CDP" : reported.includes(`${SESSION_COOKIE}=`) ? "cookie" : "WRONG COOKIE";
  return `  ${String(label).padEnd(46)} ${state.padEnd(15)} ${ended.padEnd(16)} ${cookie}`;
}

// ── Run ─────────────────────────────────────────────────────────────────────

let result;

before(async () => {
  result = await collectSockets();
  console.log(
    `Realtime browser test → ${APP_URL}${PAGE_PATH} (session from ${result.session.source}, ` +
      `${STRICT ? "strict" : "dev-tolerant"} mode)`,
  );
  console.log(`  final URL: ${result.finalUrl}`);
  console.log(`  observed sockets (${realtimeSockets(result.sockets).length} realtime):`);
  for (const socket of result.sockets) console.log(describeSocket(socket));
  if (result.consoleWsLines.length) {
    console.log("  browser console (WebSocket):");
    for (const line of new Set(result.consoleWsLines)) console.log(`    ${line}`);
  }
  if (!result.userId) {
    console.log("  note: this session carries no userId, so the user-scoped socket cannot be keyed to an account");
  }
  if (!roomsAttempted(result.sockets).size) {
    console.log("  note: no realtime room was opened — see the assertions below for the likely cause");
  }
  if (result.doView) {
    console.log(
      `  worker view: user:${result.userId} holds ${result.doView.mine.sockets} socket(s) ` +
        `(subscriptionRefs=${result.doView.mine.subscriptionRefs}); a stranger's instance holds ${result.doView.stranger.sockets}`,
    );
  } else {
    console.log(`  worker view: not checked — ${result.doViewSkipReason}`);
  }
});

// No `after` hook is needed: the browser is closed inside collectSockets, so a
// failing assertion cannot leave a Chromium process holding the terminal open.

test("the session is accepted, not bounced to /login", () => {
  assert.ok(
    !/\/login\b/.test(result.finalUrl),
    `the app redirected to ${result.finalUrl} — the session cookie was not accepted by the app itself`,
  );
});

test("at least one realtime handshake is attempted", () => {
  assert.ok(
    realtimeSockets(result.sockets).length > 0,
    "the dashboard opened no WebSocket at all — realtime is disabled (check NEXT_PUBLIC_REALTIME_URL in the build env)",
  );
});

test("no session credential travels in the socket URL", () => {
  for (const socket of realtimeSockets(result.sockets)) {
    assert.ok(
      !new URL(socket.url).searchParams.has("token"),
      `${socket.url} puts the session JWT in the query string (see audit M-7)`,
    );
  }
});

test("the session cookie is what authorized the socket (Durable Object view)", (t) => {
  if (!result.doView) return t.skip(result.doViewSkipReason);

  assert.ok(
    result.doView.mine.sockets >= 1,
    `the Worker's own Durable Object for user:${result.userId} holds no socket — the handshake never carried the ` +
      "session cookie (the socket URL carries no token, so the cookie is the only credential that could have authorized it)",
  );
  assert.equal(
    result.doView.stranger.sockets,
    0,
    "a stranger's user instance reported sockets, so the count above proves nothing about this session",
  );
});

test("no WebSocket handshake is refused", () => {
  const refusals = refusalMessages(result.sockets);
  assert.deepEqual(refusals, [], `the realtime Worker refused ${refusals.length} handshake(s): ${refusals.join("; ")}`);
});

test("every attempted room ends with a live, opened socket", () => {
  for (const room of roomsAttempted(result.sockets).keys()) {
    const opened = realtimeSockets(result.sockets).filter(
      (socket) => roomOf(socket.url) === room && socket.status === 101 && !socket.closed,
    );
    assert.ok(opened.length > 0, `room ${room} was attempted but has no open (101) socket left`);
  }
});

test("the user-scoped socket is keyed to the signed-in user", () => {
  if (!result.userId) return; // An admin session has no userId — nothing to key on.
  const keys = [...roomsAttempted(result.sockets).keys()];
  assert.ok(
    keys.includes(`user:${result.userId}`),
    `no socket for user:${result.userId} (opened: ${keys.join(", ") || "none"})`,
  );
  assert.ok(
    !keys.includes("user:global"),
    "a user:global socket was opened — identity was missing when a user-scoped room subscribed",
  );
});

test("realtime reaches the expected origin", () => {
  if (!EXPECTED_REALTIME_ORIGIN) return;
  for (const socket of realtimeSockets(result.sockets)) {
    assert.ok(
      socket.url.startsWith(`${EXPECTED_REALTIME_ORIGIN}/`),
      `${socket.url} is not on ${EXPECTED_REALTIME_ORIGIN}`,
    );
  }
});

test("communities open sockets when the account should have them", () => {
  if (!REQUIRE_COMMUNITY_SOCKETS) return;
  const communities = [...roomsAttempted(result.sockets).keys()].filter(
    (room) => !room.startsWith("user:") && !room.startsWith("notifications:") && !room.startsWith("profile:"),
  );
  assert.ok(communities.length > 0, "no community rooms opened — the account may not be a member of any community");
});

test("the Chrome DevTools protocol never reports a wrong cookie", () => {
  // Chrome hides the Cookie header on cross-origin handshakes (see the header
  // note above), so this asserts only on the sockets where it does report one.
  for (const socket of realtimeSockets(result.sockets)) {
    if (socket.cookieHeader === undefined) continue;
    assert.ok(
      socket.cookieHeader.includes(`${SESSION_COOKIE}=${result.session.cookie}`),
      `${socket.url} carried a different session than the one under test`,
    );
  }
});

// ── Strict-mode-only assertions ──────────────────────────────────────────────
// Each is reported (not failed) in dev, where StrictMode's double-invoke cancels
// one in-flight handshake per community room by design.

function strictOrReport(name, condition, detail) {
  if (condition) return;
  if (STRICT) assert.fail(`${name}: ${detail}`);
  console.log(`  warn ${name}: ${detail} (expected under next dev; run against a build with --strict)`);
}

test("every handshake completes (strict)", () => {
  const cancelled = realtimeSockets(result.sockets).filter((socket) => socket.status !== 101);
  strictOrReport(
    "cancelled handshakes",
    cancelled.length === 0,
    `${cancelled.length} socket(s) never reached 101: ${cancelled.map((s) => roomOf(s.url)).join(", ")}`,
  );
});

test("each room opens exactly one socket (strict)", () => {
  const duplicates = [...roomsAttempted(result.sockets)].filter(([, count]) => count > 1);
  strictOrReport(
    "duplicate sockets",
    duplicates.length === 0,
    duplicates.map(([room, count]) => `${room}×${count}`).join(", "),
  );
});

test("no opened socket is torn down afterwards (strict)", () => {
  const torn = realtimeSockets(result.sockets).filter((socket) => socket.status === 101 && socket.closed);
  strictOrReport(
    "sockets closed after opening",
    torn.length === 0,
    `${torn.length} socket(s): ${torn.map((s) => roomOf(s.url)).join(", ")}`,
  );
});

test("the browser console reports no failed WebSocket (strict)", () => {
  const failed = result.consoleWsLines.filter((line) => /failed/i.test(line));
  strictOrReport("console WebSocket failures", failed.length === 0, failed.join(" | "));

  const churn = churnMessages(result.sockets);
  if (churn.length && !STRICT) console.log(`  note: ${churn.length} handshake(s) cancelled mid-connect (StrictMode)`);
});
