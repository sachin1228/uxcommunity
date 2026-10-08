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
 * ASSERTED IN --seed-member (real, accepted community sockets)
 *   - every seeded community produced a socket, and it is a LIVE 101: the whole
 *     accepted path, not a refusal;
 *   - the Worker's own Durable Object for each seeded community holds that
 *     socket AND a subscription on it — accounting the client cannot fake;
 *   - the seeded rows are removed again when the run ends.
 *
 * COVERING COMMUNITY SOCKETS
 *   A member's dashboard opens one socket PER COMMUNITY, and that fan-out is
 *   where StrictMode's churn lives. Two ways in, answering different questions:
 *
 *   --seed-member [--seed-communities N] — ACCEPTED sockets.
 *     seed-member.mjs writes a throwaway member, N private communities and its
 *     memberships into the database the app reads, this file mints that member's
 *     session from SESSION_SECRET, and the dashboard loads as them. The Worker's
 *     membership check finds the rows, so every community socket is a 101. No
 *     account and no credentials: the service-role key is the one already in
 *     apps/web/.env.local, and the account it creates has no usable password.
 *     Seeding a shared project (the usual local setup — apps/web/wrangler.toml
 *     points the deployed app at the same project) additionally needs
 *     E2E_SEED_ALLOW_REMOTE=1; the rows are deleted when the run ends.
 *
 *   --mock-communities N — fan-out and REFUSAL, no database.
 *     Answers `/api/communities` with N synthetic communities, so the client
 *     fans out N community sockets exactly as it does for a member. The Worker
 *     refuses them (it checks membership), and that refusal is the point: the
 *     socket URL carries no token, so a 403 proves the session cookie
 *     authenticated the handshake while membership was denied (a missing cookie
 *     answers 401 instead, and a 101 would mean a non-member was let in).
 *
 * SESSION (first source that is configured wins; --seed-member overrides all)
 *   1. the seeded member — SESSION_SECRET read from the environment or
 *      apps/web/.dev.vars signs a session for the row --seed-member just wrote.
 *   2. E2E_SESSION_COOKIE — a `uxcommunity_session` value you already have
 *      (DevTools → Application → Cookies). Works against any target, local or
 *      deployed, and needs no secrets or database access.
 *   3. E2E_EMAIL + E2E_PASSWORD — signs in through `POST /api/auth/login`, so
 *      the real login path produces the cookie under test. Use an account that
 *      belongs to at least one community to cover the chat rooms too.
 *   4. SESSION_SECRET (+ optional E2E_USER_ID) — mints the same JWT the web app
 *      issues. This proves the client's socket lifecycle (identity, cookie, one
 *      socket, no churn) without touching the database; a community-less
 *      dashboard simply has fewer rooms.
 *
 * USAGE
 *   npm run test:e2e-realtime
 *   npm run test:e2e-realtime -- --mock-communities 3
 *   E2E_SEED_ALLOW_REMOTE=1 npm run test:e2e-realtime -- --seed-member --seed-communities 3
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
import {
  clearSeed,
  readEnvFile,
  remoteSeedRefusal,
  resolveSeedTarget,
  seedMember,
  SEED_EMAIL,
  WEB_ENV_FILE,
} from "./seed-member.mjs";

const SESSION_COOKIE = "uxcommunity_session";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DEV_VARS = path.resolve(HERE, "..", ".dev.vars");
const RT_DEV_VARS = path.resolve(HERE, "..", "..", "..", "apps", "realtime", ".dev.vars");

function mockCommunityId(index) {
  // Deterministic, so the same Durable Object instance is reused instead of a
  // fresh one per run.
  return `e2e00000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function mockCommunityRow(id, index) {
  return {
    id,
    name: `E2E community ${index}`,
    type: "interest",
    image_url: null,
    member_count: 3,
    message_count: 0,
    mention_count: 0,
    unread_content_count: 0,
    is_archived: false,
    last_read_at: null,
    last_message: null,
  };
}

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

/**
 * How many synthetic communities to serve the sidebar. The sidebar only keeps
 * SIDEBAR_REALTIME_LIMIT (15) communities live, so more than that would just
 * leave the extra rows dormant.
 */
const MOCK_COMMUNITIES = Math.max(
  0,
  Math.min(15, Number(argValue("--mock-communities") ?? process.env.E2E_MOCK_COMMUNITIES ?? 0) || 0),
);

/**
 * Sign in as a member this test creates itself (see seed-member.mjs). It is the
 * only option that covers ACCEPTED community sockets without depending on an
 * account, a password or a fixture somebody has to maintain.
 */
const SEED_MEMBER = process.argv.includes("--seed-member") || process.env.E2E_SEED_MEMBER === "1";
const SEED_COMMUNITIES = Math.max(
  1,
  Math.min(15, Number(argValue("--seed-communities") ?? process.env.E2E_SEED_COMMUNITIES ?? 1) || 1),
);
/** Leave the seeded rows in place instead of removing them at the end. */
const KEEP_SEED = process.argv.includes("--keep-seed") || process.env.E2E_KEEP_SEED === "1";

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

/** SESSION_SECRET, from the environment or the app's own dev vars. */
function sessionSecret() {
  const devVars = readDevVars(WEB_DEV_VARS);
  return {
    secret: process.env.SESSION_SECRET || devVars?.SESSION_SECRET || "",
    source: process.env.SESSION_SECRET ? "SESSION_SECRET (environment)" : "SESSION_SECRET (apps/web/.dev.vars)",
  };
}

/**
 * The seeded member's session. Minted from SESSION_SECRET, because the seeded
 * row deliberately has no password anybody knows (seed-member.mjs hashes a
 * throwaway secret) — which is exactly why this run needs no credentials.
 */
async function seededSession(userId) {
  const { secret, source } = sessionSecret();
  if (!secret) {
    throw new Error(
      "--seed-member needs SESSION_SECRET to mint the seeded member's session: set it, or keep it in apps/web/.dev.vars",
    );
  }
  return { cookie: await buildSmokeToken(secret, userId), source: `${source}, as the seeded member ${userId}` };
}

/** Resolve the session under test, plus the user id it belongs to. */
async function resolveSession() {
  if (process.env.E2E_SESSION_COOKIE) {
    return { cookie: process.env.E2E_SESSION_COOKIE.trim(), source: "E2E_SESSION_COOKIE" };
  }

  const loggedIn = await loginForCookie();
  if (loggedIn) return { cookie: loggedIn, source: "POST /api/auth/login" };

  const { secret, source } = sessionSecret();
  if (secret) {
    const userId = process.env.E2E_USER_ID || SENTINEL_USER_ID;
    return { cookie: await buildSmokeToken(secret, userId), source };
  }

  throw new Error(
    "no session available: set E2E_SESSION_COOKIE, or E2E_EMAIL + E2E_PASSWORD, or SESSION_SECRET",
  );
}

/**
 * Write the throwaway member this run signs in as. The target is resolved the
 * way the app resolves it (environment, then its own .env.local), and a shared
 * project is refused unless the operator acknowledged it — see seed-member.mjs.
 */
async function seedForRun() {
  const target = resolveSeedTarget({ envText: readEnvFile(WEB_ENV_FILE) });
  const refusal = remoteSeedRefusal(target);
  if (refusal) throw new Error(refusal);
  console.log(`  seeding → ${target.supabaseUrl} (${target.local ? "local" : "shared/remote, acknowledged"})`);
  const seeded = await seedMember({ target, communities: SEED_COMMUNITIES, log: (line) => console.log(`  ${line}`) });
  return { ...seeded, target };
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
  if (SEED_MEMBER && MOCK_COMMUNITIES) {
    throw new Error(
      "--seed-member and --mock-communities cannot be combined: the mock replaces the very /api/communities " +
        "response the seeded member's communities have to arrive in",
    );
  }

  const seed = SEED_MEMBER ? await seedForRun() : null;
  const session = seed ? await seededSession(seed.userId) : await resolveSession();
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

  // The sidebar's community list is a CLIENT fetch, which is what makes the
  // fan-out reachable without an account: N communities in, N chat sockets out.
  const mockedCommunityIds = Array.from({ length: MOCK_COMMUNITIES }, (_, i) => mockCommunityId(i + 1));
  if (mockedCommunityIds.length) {
    const rows = mockedCommunityIds.map((id, i) => mockCommunityRow(id, i + 1));
    await page.route(
      (url) => url.pathname === "/api/communities",
      (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ communities: rows }) }),
    );
  }

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

  // The seeded member's own communities, asked of each COMMUNITY Durable Object:
  // this is the accepted path proven from the Worker's side. The membership API
  // had to answer ok for the socket to be in the room at all, and a subscription
  // ref can only come from the `subscribe` frame the client sends after 101.
  const seededDoView = [];
  let seededDoViewSkipReason = null;
  if (seed) {
    if (!target?.publishSecret) {
      seededDoViewSkipReason =
        "REALTIME_PUBLISH_SECRET is not configured (environment or apps/realtime/.dev.vars)";
    } else {
      const views = await Promise.all(
        seed.communityIds.map((id) => doStats(target.httpOrigin, target.publishSecret, `chat:${id}`)),
      );
      views.forEach((view, index) => {
        seededDoView.push({
          room: `chat:${seed.communityIds[index]}`,
          sockets: view.sockets,
          subscriptionRefs: view.subscriptionRefs,
        });
      });
    }
  }

  const finalUrl = page.url();
  await browser.close();

  // Remove the seeded rows now. Everything the assertions need is already
  // recorded, so a failing assertion cannot be what decides whether a shared
  // database keeps a test member — but a failing CLEANUP is itself asserted.
  let seedCleanup = null;
  if (seed) {
    if (KEEP_SEED) {
      seedCleanup = {
        removed: false,
        users: 0,
        communities: 0,
        detail: `left behind (--keep-seed): ${SEED_EMAIL} and communities ${seed.communityIds.join(", ")}`,
      };
    } else {
      try {
        const { removed } = await clearSeed({ target: seed.target, log: () => {} });
        seedCleanup = {
          removed: true,
          users: removed.users,
          communities: removed.communities,
          detail: `removed ${removed.users} member(s) and ${removed.communities} community(ies)`,
        };
      } catch (error) {
        seedCleanup = { removed: false, users: 0, communities: 0, detail: `cleanup failed — ${error.message}` };
      }
    }
  }

  return {
    session,
    userId,
    sockets: [...sockets.values()],
    consoleWsLines,
    finalUrl,
    doView,
    doViewSkipReason,
    seededDoView,
    seededDoViewSkipReason,
    seed: seed ? { userId: seed.userId, communityIds: seed.communityIds } : null,
    seedCleanup,
    mockedCommunityIds,
  };
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

/**
 * The status the Worker refused a handshake with. Chrome reports it inside the
 * frame error ("Error during WebSocket handshake: Unexpected response code: 403")
 * and sends no response event, so the status has to come out of the message.
 * Null means the socket was never refused — it opened, or it was cancelled.
 */
function refusalStatusOf(socket) {
  for (const message of socket.frameErrors) {
    const match = /Unexpected response code: (\d{3})/i.exec(message);
    if (match) return Number(match[1]);
    if (/authentication failed|no valid credentials/i.test(message)) return 401;
  }
  return socket.status !== null && socket.status !== 101 ? socket.status : null;
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

/** Rooms the mocked run EXPECTS the Worker to refuse (membership is enforced). */
function mockedRooms() {
  return new Set(result.mockedCommunityIds.map((id) => `chat:${id}`));
}

const isExpectedRefusal = (socket) => mockedRooms().has(roomOf(socket.url) ?? "");

/** Every realtime socket that is NOT an expected mocked-community refusal. */
const unexpectedSockets = () => realtimeSockets(result.sockets).filter((socket) => !isExpectedRefusal(socket));

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
  if (result.mockedCommunityIds.length) {
    console.log(
      `  mocked communities: ${result.mockedCommunityIds.length} served to the sidebar; their chat rooms are expected ` +
        `to be refused with 403 (the session is not a member of them)`,
    );
  }
  if (result.seed) {
    console.log(
      `  seeded member: ${result.seed.userId} with ${result.seed.communityIds.length} community(ies) — their chat ` +
        "sockets are expected to be ACCEPTED (101)",
    );
  }
  if (result.doView) {
    console.log(
      `  worker view: user:${result.userId} holds ${result.doView.mine.sockets} socket(s) ` +
        `(subscriptionRefs=${result.doView.mine.subscriptionRefs}); a stranger's instance holds ${result.doView.stranger.sockets}`,
    );
  } else {
    console.log(`  worker view: not checked — ${result.doViewSkipReason}`);
  }
  if (result.seed) {
    console.log(
      result.seededDoView.length
        ? "  worker view (seeded communities): " +
            result.seededDoView
              .map((view) => `${view.room} sockets=${view.sockets} subscriptionRefs=${view.subscriptionRefs}`)
              .join("; ")
        : `  worker view (seeded communities): not checked — ${result.seededDoViewSkipReason}`,
    );
    console.log(`  seeded member cleanup: ${result.seedCleanup.detail}`);
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
  const refusals = refusalMessages(unexpectedSockets());
  assert.deepEqual(refusals, [], `the realtime Worker refused ${refusals.length} handshake(s): ${refusals.join("; ")}`);
});

test("every attempted room ends with a live, opened socket", () => {
  const sockets = unexpectedSockets();
  for (const room of roomsAttempted(sockets).keys()) {
    const opened = sockets.filter((socket) => roomOf(socket.url) === room && socket.status === 101 && !socket.closed);
    assert.ok(opened.length > 0, `room ${room} was attempted but has no open (101) socket left`);
  }
});

// ── Seeded-member coverage (--seed-member) ──────────────────────────────────
// The other half of the community coverage: a member the Worker ADMITS. The
// membership check runs in the app (a server-to-server call from the Durable
// Object), so these sockets only open when the seeded rows are really there — a
// 101 cannot be faked by the client, and the Durable Object view below is the
// Worker's own accounting of what is inside the room.

test("each seeded community socket is accepted, not refused (--seed-member)", (t) => {
  if (!result.seed) return t.skip("run with --seed-member to cover accepted community sockets");

  const missing = [];
  const refused = [];
  for (const id of result.seed.communityIds) {
    const room = `chat:${id}`;
    const sockets = realtimeSockets(result.sockets).filter((socket) => roomOf(socket.url) === room);
    if (!sockets.length) {
      missing.push(room);
      continue;
    }
    if (!sockets.some((socket) => socket.status === 101 && !socket.closed)) {
      refused.push(`${room} → ${sockets.map((socket) => refusalStatusOf(socket) ?? "no response").join(", ")}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `${missing.length} of ${result.seed.communityIds.length} seeded community(ies) produced no socket at all: ` +
      "the seeded member's communities never reached the sidebar",
  );
  assert.deepEqual(
    refused,
    [],
    `the Worker refused ${refused.length} community(ies) the seeded member belongs to: ` +
      `${refused.join("; ")} — the membership check did not see the seeded rows (is the Worker's API_URL the app ` +
      "that reads this database?)",
  );
});

test("the Worker's Durable Objects hold the seeded member's sockets (--seed-member)", (t) => {
  if (!result.seed) return t.skip("run with --seed-member to cover accepted community sockets");
  if (!result.seededDoView.length) return t.skip(result.seededDoViewSkipReason);

  const empty = result.seededDoView.filter((view) => view.sockets < 1).map((view) => view.room);
  assert.deepEqual(
    empty,
    [],
    `${empty.join(", ")} hold no socket: the handshake never reached the room, so the membership check must ` +
      "have refused it first",
  );

  const silent = result.seededDoView.filter((view) => view.subscriptionRefs < 1).map((view) => view.room);
  assert.deepEqual(
    silent,
    [],
    `${silent.join(", ")} hold a socket that never subscribed: the client opened the room and stalled — the ` +
      "`join`/`subscribe` frames did not arrive",
  );
});

test("the seeded member is removed again (--seed-member)", (t) => {
  if (!result.seed) return t.skip("run with --seed-member to cover accepted community sockets");
  if (KEEP_SEED) return t.skip("--keep-seed: the seeded rows are meant to stay");

  const cleanup = result.seedCleanup;
  assert.ok(
    cleanup?.removed,
    `the seeded rows are still in the database: ${cleanup?.detail} — remove them with ` +
      "`node apps/web/e2e/seed-member.mjs --cleanup`",
  );
  // Counted, not assumed: a delete whose filter matches nothing also succeeds.
  assert.equal(
    cleanup.users,
    1,
    `cleanup deleted ${cleanup.users} member(s), not the one it seeded — ${SEED_EMAIL} was already gone, or the ` +
      "wrong rows were touched",
  );
  assert.equal(
    cleanup.communities,
    result.seed.communityIds.length,
    `cleanup deleted ${cleanup.communities} of the ${result.seed.communityIds.length} seeded community(ies)`,
  );
});

// ── Mocked-community coverage (--mock-communities N) ─────────────────────────
// The fan-out a member's dashboard has, without a member account. The Worker
// refuses these rooms because the session is not a member — which is itself the
// assertion: the refusal must be 403 (authenticated, membership denied), never
// 401 (unauthenticated) and never a 101 (a non-member let in).

test("each mocked community gets its own socket (--mock-communities)", (t) => {
  if (!result.mockedCommunityIds.length) {
    return t.skip("run with --mock-communities N to cover the community socket fan-out");
  }

  const attempted = roomsAttempted(result.sockets);
  const missing = result.mockedCommunityIds.filter((id) => !attempted.has(`chat:${id}`));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} of ${result.mockedCommunityIds.length} mocked community(ies) produced no socket at all: ` +
      "the sidebar must fan out one chat socket per community",
  );
});

test("a non-member community socket is refused with 403, never 401", (t) => {
  if (!result.mockedCommunityIds.length) {
    return t.skip("run with --mock-communities N to cover the community socket refusal path");
  }

  const statuses = new Set();
  for (const socket of realtimeSockets(result.sockets)) {
    if (!isExpectedRefusal(socket)) continue;
    const status = refusalStatusOf(socket);
    assert.notEqual(
      status,
      101,
      `${socket.url} was ACCEPTED — the Worker let this session into a community it is not a member of`,
    );
    assert.notEqual(
      status,
      401,
      `${socket.url} answered 401: the handshake was unauthenticated, so the session cookie never reached the Worker`,
    );
    if (status !== null) statuses.add(status);
  }
  assert.ok(
    statuses.has(403),
    `no mocked community socket was refused with 403 (saw: ${[...statuses].join(", ") || "no refusal"}) — the membership ` +
      "check is how this test proves the cookie authenticated the handshake",
  );
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
  const cancelled = unexpectedSockets().filter((socket) => socket.status !== 101);
  strictOrReport(
    "cancelled handshakes",
    cancelled.length === 0,
    `${cancelled.length} socket(s) never reached 101: ${cancelled.map((s) => roomOf(s.url)).join(", ")}`,
  );
});

test("each room opens exactly one socket (strict)", () => {
  const duplicates = [...roomsAttempted(unexpectedSockets())].filter(([, count]) => count > 1);
  strictOrReport(
    "duplicate sockets",
    duplicates.length === 0,
    duplicates.map(([room, count]) => `${room}×${count}`).join(", "),
  );
});

test("no opened socket is torn down afterwards (strict)", () => {
  const torn = unexpectedSockets().filter((socket) => socket.status === 101 && socket.closed);
  strictOrReport(
    "sockets closed after opening",
    torn.length === 0,
    `${torn.length} socket(s): ${torn.map((s) => roomOf(s.url)).join(", ")}`,
  );
});

test("the browser console reports no failed WebSocket (strict)", () => {
  // A mocked community's refusal is expected (see the mock-communities section),
  // so it is not a console failure this test should fail on.
  const failed = result.consoleWsLines.filter(
    (line) => /failed/i.test(line) && !result.mockedCommunityIds.some((id) => line.includes(id)),
  );
  strictOrReport("console WebSocket failures", failed.length === 0, failed.join(" | "));

  const churn = churnMessages(result.sockets);
  if (churn.length && !STRICT) console.log(`  note: ${churn.length} handshake(s) cancelled mid-connect (StrictMode)`);
});
