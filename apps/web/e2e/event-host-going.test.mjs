#!/usr/bin/env node

/**
 * End-to-end regression: the host is going to the event they create.
 *
 * WHY THIS EXISTS
 *   Creating an event puts its creator in the event's group chat — but the
 *   "is this member going?" answer lives in `event_rsvps`, and the create route
 *   did not write the host's row there. Every surface that draws the count
 *   reads that table (the home-feed RPCs, the community list-page RPC, the
 *   attendee strip, the going list), so the host's own card offered them the
 *   "I'm Going" button and the count left them out. The route writes the row
 *   with the event now, and a migration backfilled the events that predate it;
 *   this test walks the real route over HTTP and fails if the host ever stops
 *   being counted again. The unit suite cannot see this — it has no database.
 *
 * WHAT IT DOES
 *   1. seeds the throwaway e2e member and one private community it owns
 *      (apps/web/e2e/seed-member.mjs). That seeder refuses a non-loopback
 *      database unless E2E_SEED_ALLOW_REMOTE=1, and removes its own rows when
 *      the run ends;
 *   2. picks the app to drive — `--url` / `E2E_APP_URL`, else the dev server
 *      already answering on :3000, else one it starts itself on :3119 — and
 *      mints the seeded member's session from SESSION_SECRET. The seeded row's
 *      password is a secret the seeder throws away, so there is no account to
 *      configure;
 *   3. POSTs the create-event route and asserts the response, the database and
 *      the community's event list all agree the host is going — then withdraws
 *      the RSVP (the card's own toggle) and takes the undo offer's action (the
 *      same POST), asserting both directions on the same three surfaces. The
 *      withdraw leg also pins the host-only rule that the room keeps them: the
 *      group chat is the host's, so withdrawing never evicts them from it;
 *   4. deletes the event and its room, and clears the seed.
 *
 * RUN (from the repo root)
 *   npm run test:e2e-event-host-going
 *   E2E_SEED_ALLOW_REMOTE=1 npm run test:e2e-event-host-going   # shared project
 *   npm run test:e2e-event-host-going -- --url http://localhost:3000
 *   npm run test:e2e-event-host-going -- --keep-seed            # keep the rows for inspection
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

import { parseDevVars } from "../../../scripts/smoke-realtime.mjs";
import {
  clearSeed,
  readEnvFile,
  remoteSeedRefusal,
  resolveSeedTarget,
  seedCommunityId,
  seedMember,
  SEED_USER_ID,
  WEB_ENV_FILE,
} from "./seed-member.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const ROOT = path.resolve(HERE, "..", "..", "..");
const WEB_DEV_VARS = path.join(APP_DIR, ".dev.vars");

/** The app's own cookie name (lib/auth/session.ts). */
const SESSION_COOKIE = "uxcommunity_session";

/** Where a dev server is assumed to live, as everywhere else in this repo. */
const DEFAULT_APP = "http://localhost:3000";

/**
 * A spare port for the dev server this run starts. Next 16 allows ONE `next dev`
 * per project directory, so the run must not simply spawn its own when the
 * operator already has one up — it uses theirs instead (see resolveApp).
 */
const DEV_PORT = 3119;

/**
 * The app's session lifetime (7 days, lib/auth/session.ts). Deliberately NOT
 * the smoke test's 120-second token: that TTL exists because its token lands in
 * the realtime Worker's logs, while this run may spend a minute compiling the
 * routes on a cold `next dev` before its requests go out.
 */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** SESSION_SECRET with the precedence the dev server itself uses. */
function sessionSecret() {
  if (process.env.SESSION_SECRET) {
    return { secret: process.env.SESSION_SECRET, source: "SESSION_SECRET (environment)" };
  }
  const fromLocal = parseDevVars(readEnvFile(WEB_ENV_FILE)).SESSION_SECRET;
  if (fromLocal) return { secret: fromLocal, source: "SESSION_SECRET (apps/web/.env.local)" };
  const fromDevVars = parseDevVars(readEnvFile(WEB_DEV_VARS)).SESSION_SECRET;
  if (fromDevVars) return { secret: fromDevVars, source: "SESSION_SECRET (apps/web/.dev.vars)" };
  return { secret: "", source: "" };
}

/** The same JWT the web app issues for a user session (lib/auth/session.ts). */
async function mintSession(secret, userId) {
  return new SignJWT({ userId, email: "e2e-host-going@e2e.invalid", role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

function startDevServer() {
  const nextBin = path.join(ROOT, "node_modules/next/dist/bin/next");
  const proc = spawn("node", [nextBin, "dev", "-p", String(DEV_PORT)], {
    cwd: APP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (chunk) => { output += chunk; });
  proc.stderr.on("data", (chunk) => { output += chunk; });
  return { proc, read: () => output };
}

/** Whether an app answers as this one does — `GET /login` on the base URL. */
async function appAnswers(base) {
  try {
    const response = await fetch(`${base}/login`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApp(base, proc, read) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${base}/login`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((done) => setTimeout(done, 1000));
  }
  proc?.kill("SIGKILL");
  console.error(read().slice(-2000));
  throw new Error("dev server did not start");
}

/** The event as the community's list route (the feed read model) reports it. */
async function fetchListedEvent(base, communityId, eventId, cookie) {
  const response = await fetch(`${base}/api/communities/${communityId}/events`, { headers: { cookie } });
  const body = await response.json().catch(() => ({}));
  return (body.events ?? []).find((row) => row.id === eventId) ?? null;
}

/** The RSVP route's toggle, the exact request the card's button fires. */
async function postRsvp(base, communityId, eventId, cookie) {
  const response = await fetch(`${base}/api/communities/${communityId}/events/${eventId}/rsvp`, {
    method: "POST",
    headers: { cookie },
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
}

async function main() {
  const target = resolveSeedTarget({ envText: readEnvFile(WEB_ENV_FILE) });
  const refusal = remoteSeedRefusal(target);
  if (refusal) throw new Error(refusal);

  const log = (line) => console.log(`  ${line}`);
  console.log(`Event host-going regression → ${target.supabaseUrl} (${target.local ? "local" : "shared/remote, acknowledged"})`);

  const db = createClient(target.supabaseUrl, target.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { secret, source } = sessionSecret();
  if (!secret) {
    throw new Error(
      "no SESSION_SECRET: set it, or keep it in apps/web/.env.local — the seeded member's session is minted from it",
    );
  }
  const cookie = `${SESSION_COOKIE}=${await mintSession(secret, SEED_USER_ID)}`;
  console.log(`  session minted from ${source}, as the seeded member ${SEED_USER_ID}`);

  const explicitBase = (process.env.E2E_APP_URL || argValue("--url") || "").replace(/\/+$/, "");
  // --url wins, then a server that is already up, and only then one of our own:
  // spawning a second `next dev` in this directory would refuse to start and
  // leave the operator without a run.
  const reuseRunning = !explicitBase && (await appAnswers(DEFAULT_APP));
  const base = explicitBase || (reuseRunning ? DEFAULT_APP : `http://localhost:${DEV_PORT}`);

  const communityId = seedCommunityId(1);
  const keepSeed = process.argv.includes("--keep-seed");

  let eventId = null;
  let roomId = null;
  let devServer = null;
  let readDevServerOutput = () => "";

  if (explicitBase) {
    console.log(`  app under test: ${base} (--url / E2E_APP_URL)`);
  } else if (reuseRunning) {
    console.log(`  app under test: ${base} (already running)`);
  } else {
    const server = startDevServer();
    devServer = server.proc;
    readDevServerOutput = server.read;
    console.log(`  app under test: ${base} (starting next dev…)`);
  }

  try {
    // Inside the try: a half-seeded run must still reach the cleanup in the
    // finally, and clearSeed is safe to call when nothing was written.
    await seedMember({ target, communities: 1, log });
    if (devServer) await waitForApp(base, devServer, readDevServerOutput);

    // ── 1. Create the event through the route the composer calls ──
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const created = await fetch(`${base}/api/communities/${communityId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        title: `E2E host-going ${start.toISOString()}`,
        event_date: start.toISOString(),
        end_date: end.toISOString(),
        is_online: true,
      }),
    });
    const body = await created.json().catch(() => ({}));
    check(
      "create route answers 201",
      created.status === 201,
      `status ${created.status}${body.error ? ` — ${body.error}` : ""}`,
    );

    const event = body.event ?? {};
    eventId = event.id ?? null;
    roomId = body.chat_community_id ?? null;
    check("the event got its own group chat", Boolean(roomId), `chat_community_id=${roomId}`);

    // The four reads the legs below are written in terms of, bound once here.
    const listedEvent = () => fetchListedEvent(base, communityId, eventId, cookie);
    const toggleRsvp = () => postRsvp(base, communityId, eventId, cookie);
    const rsvpRow = async () => {
      const { data } = await db
        .from("event_rsvps")
        .select("user_id")
        .eq("event_id", eventId)
        .eq("user_id", SEED_USER_ID)
        .maybeSingle();
      return data ?? null;
    };
    const roomSeat = async () => {
      const { data } = await db
        .from("community_members")
        .select("community_id")
        .eq("community_id", roomId)
        .eq("user_id", SEED_USER_ID)
        .maybeSingle();
      return data ?? null;
    };

    // The two fields the card renders the button and the count from. This is
    // the regression: without the host's RSVP they read false / 0.
    check("create response says the host is going", event.user_rsvped === true, `user_rsvped=${event.user_rsvped}`);
    check("create response counts the host", event.rsvp_count === 1, `rsvp_count=${event.rsvp_count}`);

    // ── 2. Ground truth: the row the counts are computed from ──
    check("event_rsvps holds the host's row", Boolean(await rsvpRow()));

    // ── 3. The community's event list — the list-page RPC every feed reads ──
    const listed = await listedEvent();
    check("list route returns the event", Boolean(listed));
    check("list says the host is going", listed?.user_rsvped === true, `user_rsvped=${listed?.user_rsvped}`);
    check("list's going count includes the host", listed?.rsvp_count === 1, `rsvp_count=${listed?.rsvp_count}`);

    // ── 4. The premise of the fix: the host is in the room the event made ──
    check("host is a member of the event's group chat", Boolean(await roomSeat()));

    // ── 5. Withdrawing (the card's "Going ✓" tap, confirmed): the host leaves
    // the going list — and keeps their seat in their own room, because the
    // group chat is the host's to manage (leaveEventChat never removes the
    // owner). Both halves are asserted: a route that stopped removing the RSVP
    // would leave a ghost attendee, and one that started evicting the owner
    // would take the room's only manager out of it.
    const withdrawn = await toggleRsvp();
    check(
      "withdraw route answers rsvped:false",
      withdrawn.ok && withdrawn.body.rsvped === false,
      `status ${withdrawn.status} — ${JSON.stringify(withdrawn.body)}`,
    );
    check("withdraw reports the host's going count as 0", withdrawn.body.rsvp_count === 0, `rsvp_count=${withdrawn.body.rsvp_count}`);
    check(
      "withdraw names the room the sidebar drops",
      withdrawn.body.chat_community_id === roomId,
      `chat_community_id=${withdrawn.body.chat_community_id}`,
    );
    check("the host's RSVP row is gone", !(await rsvpRow()));
    check("the host keeps their seat in their own room", Boolean(await roomSeat()));

    const listedAfterWithdraw = await listedEvent();
    check(
      "list says the host is not going",
      listedAfterWithdraw?.user_rsvped === false,
      `user_rsvped=${listedAfterWithdraw?.user_rsvped}`,
    );
    check(
      "list's going count drops to 0",
      listedAfterWithdraw?.rsvp_count === 0,
      `rsvp_count=${listedAfterWithdraw?.rsvp_count}`,
    );

    // ── 6. Taking the undo offer. The toast's action is the same POST again
    // (EventCard.restoreRsvp), which is what re-registers the host — and the
    // path the original revert bug lived on, so it is checked end to end.
    const restored = await toggleRsvp();
    check(
      "undo (RSVP again) answers rsvped:true",
      restored.ok && restored.body.rsvped === true,
      `status ${restored.status} — ${JSON.stringify(restored.body)}`,
    );
    check("undo counts the host again", restored.body.rsvp_count === 1, `rsvp_count=${restored.body.rsvp_count}`);
    check("the host's RSVP row is back", Boolean(await rsvpRow()));

    const listedAfterUndo = await listedEvent();
    check("list says the host is going again", listedAfterUndo?.user_rsvped === true, `user_rsvped=${listedAfterUndo?.user_rsvped}`);
    check("list's going count is back to 1", listedAfterUndo?.rsvp_count === 1, `rsvp_count=${listedAfterUndo?.rsvp_count}`);
  } finally {
    if (keepSeed) {
      console.log(`  --keep-seed: leaving event ${eventId}, room ${roomId} and the seed in place`);
    } else {
      try {
        // The room's own community row first: deleting the event would only
        // detach it (the group chat outlives its event by design), leaving a
        // row this test made behind.
        if (roomId) {
          const { data } = await db.from("communities").delete().eq("id", roomId).select("id");
          log(`removed the event's group chat (${data?.length ?? 0} row)`);
        }
        if (eventId) {
          const { data } = await db.from("community_events").delete().eq("id", eventId).select("id");
          log(`removed the e2e event (${data?.length ?? 0} row)`);
        }
        await clearSeed({ target, log });
      } catch (error) {
        // A leftover seed is a failure of this run, not a detail: the next run
        // would replace it, but the database would carry rows nobody expects.
        failures += 1;
        console.error(`  ✗ cleanup failed — ${error.message}`);
      }
    }
    devServer?.kill("SIGKILL");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nEvent host-going regression FAILED: ${error.message}\n`);
  process.exit(1);
});
