/**
 * Live regression test for the "I'm going" RSVP revert bug.
 *
 * Reproduces the user-reported flow: login → load home feed → RSVP to the
 * first event → immediately reload the feed. Before the fix, the RSVP insert
 * error was swallowed AND the 10s unstable_cache home-feed snapshot kept
 * serving user_rsvped:false, so the button reverted after refresh.
 *
 * Uses a k6 seed test user (avatar temporarily set so login succeeds, then
 * restored). Env vars are read but never printed.
 *
 * Run from repo root:  node k6/scripts/rsvp-regression-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(ROOT, "apps/web");
const PORT = 3117; // avoid clashing with any other dev server
const BASE = `http://localhost:${PORT}`;

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* optional file */ }
}
loadEnv(path.join(WEB, ".env.local"));
loadEnv(path.join(WEB, ".env"));
loadEnv(path.join(ROOT, ".env.local"));

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("FAIL: Supabase env missing");
  process.exit(1);
}
const db = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const EMAIL = "k6user_01@k6test.invalid";
const PASSWORD = "K6testPass123!";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function waitForServer(proc) {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  proc.kill("SIGKILL");
  console.error(serverOutput.slice(-2000));
  throw new Error("dev server did not start");
}

async function main() {
  // ── Fixture: make sure the test user can log in (avatar is required) ──
  let { data: user } = await db.from("users").select("id").eq("email", EMAIL).maybeSingle();
  let createdUser = false;
  if (!user) {
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash(PASSWORD, 10);
    const { data, error } = await db
      .from("users")
      .insert({ name: "k6 Test User 01", email: EMAIL, password_hash: hash, is_blocked: false })
      .select("id")
      .single();
    if (error) throw new Error(`cannot create test user: ${error.message}`);
    user = data;
    createdUser = true;
  }
  const userId = user.id;

  let { data: profile } = await db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", userId).maybeSingle();
  const originalAvatar = profile?.avatar_url ?? null;
  if (!profile) {
    const { data: level } = await db.from("experience_levels").select("value").limit(1);
    const { error } = await db.from("designer_profiles").insert({
      user_id: userId,
      experience_level: level?.[0]?.value ?? "mid",
      avatar_url: "https://example.com/k6-avatar.png",
    });
    if (error) throw new Error(`cannot create profile: ${error.message}`);
  } else if (!originalAvatar) {
    const { error } = await db.from("designer_profiles").update({ avatar_url: "https://example.com/k6-avatar.png" }).eq("user_id", userId);
    if (error) throw new Error(`cannot set avatar: ${error.message}`);
  }

  // Clean slate: remove any leftover RSVP by this user.
  await db.from("event_rsvps").delete().eq("user_id", userId);

  // ── Start the dev server ──
  console.log("Starting dev server…");
  const nextBin = path.join(ROOT, "node_modules/next/dist/bin/next");
  const proc = spawn("node", [nextBin, "dev", "-p", String(PORT)], {
    cwd: WEB,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  proc.stdout.on("data", (d) => { serverOutput += d; });
  proc.stderr.on("data", (d) => { serverOutput += d; });
  try {
    await waitForServer(proc);

    // ── 1. Login ──
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    check("login succeeds", login.status === 200, `status ${login.status}`);
    const cookie = (login.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .filter((c) => c.startsWith("uxcommunity_session="))
      .join("; ");
    check("session cookie set", cookie.length > 0);
    const authHeaders = { cookie };

    // ── 2. Load home feed, find the first event ──
    const feed1 = await fetch(`${BASE}/api/home/feed`, { headers: authHeaders });
    const feed1Data = await feed1.json();
    const event = (feed1Data.items ?? []).find((it) => it._type === "event");
    check("home feed has an event", Boolean(event));
    if (!event) throw new Error("no event in feed to test against");
    check("event starts un-RSVPed", event.user_rsvped === false, `user_rsvped=${event.user_rsvped}`);

    // ── 3. RSVP (the exact request the "I'm Going" button fires) ──
    const rsvp = await fetch(`${BASE}/api/communities/${event.community_id}/events/${event.id}/rsvp`, {
      method: "POST",
      headers: authHeaders,
    });
    const rsvpBody = await rsvp.json().catch(() => ({}));
    check("RSVP returns 200 + rsvped:true", rsvp.ok && rsvpBody.rsvped === true, JSON.stringify(rsvpBody));

    // ── 4. REGRESSION: feed must show the RSVP immediately after ──
    const feed2 = await fetch(`${BASE}/api/home/feed`, { headers: authHeaders });
    const feed2Data = await feed2.json();
    const event2 = (feed2Data.items ?? []).find((it) => it._type === "event" && it.id === event.id);
    check("feed shows user_rsvped:true right after clicking (no revert)", event2?.user_rsvped === true, `user_rsvped=${event2?.user_rsvped}`);
    check("rsvp_count incremented", event2?.rsvp_count === (event.rsvp_count ?? 0) + 1, `${event.rsvp_count} → ${event2?.rsvp_count}`);
    const inPreviews = (event2?.rsvps ?? []).some((r) => r.user_id === userId);
    check("attendee preview includes the user (avatar stack)", inPreviews);

    // ── 5. Cleanup: toggle back off, verify it un-registers ──
    const rsvpOff = await fetch(`${BASE}/api/communities/${event.community_id}/events/${event.id}/rsvp`, {
      method: "POST",
      headers: authHeaders,
    });
    const offBody = await rsvpOff.json().catch(() => ({}));
    check("second click toggles off (rsvped:false)", rsvpOff.ok && offBody.rsvped === false, JSON.stringify(offBody));
    const feed3 = await fetch(`${BASE}/api/home/feed`, { headers: authHeaders });
    const event3 = ((await feed3.json()).items ?? []).find((it) => it._type === "event" && it.id === event.id);
    check("feed shows user_rsvped:false after toggle-off", event3?.user_rsvped === false);
  } finally {
    // ── Restore fixture state ──
    await db.from("event_rsvps").delete().eq("user_id", userId);
    if (createdUser) {
      await db.from("users").delete().eq("id", userId);
    } else if (profile && !originalAvatar) {
      await db.from("designer_profiles").update({ avatar_url: null }).eq("user_id", userId);
    }
    proc.kill("SIGKILL");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
