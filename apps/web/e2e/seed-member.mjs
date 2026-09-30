#!/usr/bin/env node

/**
 * Seed — and remove — the local test member the browser test signs in as.
 *
 * WHY THIS EXISTS
 *   `--mock-communities` proved everything about a community socket EXCEPT the
 *   part that a real member exercises: N synthetic communities make the sidebar
 *   fan out N sockets, and the Worker refuses every one of them (403), which
 *   proves the session cookie authenticated the handshake but never proves the
 *   ACCEPTED path — the 101, the subscribe that follows it, and the socket that
 *   stays up. That path needs a membership the Worker's membership check can
 *   find, and a membership needs rows in the database the app reads.
 *
 *   Those rows are what this module writes. Nothing has to be handed to the
 *   test to make it work: the service-role key is already part of the local dev
 *   environment (apps/web/.env.local), and the session is minted from
 *   SESSION_SECRET, so there is no password and no account to create by hand.
 *
 * WHAT IT WRITES (all keyed to fixed ids, so a re-run replaces its own rows)
 *   users              1 row    e2e-realtime@e2e.invalid
 *   communities        N rows   private, member-led, chat tab enabled
 *   community_members  N rows   role owner
 *   No `designer_profiles` row, deliberately — see the note in seedMember().
 *
 * WHY IT IS REFUSED AGAINST A REMOTE PROJECT BY DEFAULT
 *   The local dev app usually points at the SAME Supabase project the deployed
 *   app uses (apps/web/.env.local, apps/web/wrangler.toml), so "seed locally"
 *   can mean "insert rows into shared data". Seeding therefore stops when the
 *   target host is not loopback unless the operator says E2E_SEED_ALLOW_REMOTE=1
 *   — and the seeded communities are private, so they never appear as joinable
 *   to anyone else while they exist. Cleanup only ever deletes the ids and the
 *   email below.
 *
 * USAGE
 *   node apps/web/e2e/seed-member.mjs --dry-run            what would be written, where
 *   node apps/web/e2e/seed-member.mjs --communities 3      seed 3 communities
 *   node apps/web/e2e/seed-member.mjs --cleanup            remove them again
 *
 *   The browser test does all three itself: `npm run test:e2e-realtime --
 *   --seed-member --seed-communities 3`.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

import { parseDevVars } from "../../../scripts/smoke-realtime.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The app's own dev env file — where the service-role key already lives. */
export const WEB_ENV_FILE = path.resolve(HERE, "..", ".env.local");

// ── Identity ────────────────────────────────────────────────────────────────
// Fixed, READABLE ids: a re-run replaces exactly these rows, cleanup can delete
// a seed that a killed run left behind, and an id in a log line says what it is.
// (`e2e00000-…-0ee001` is the member, `0cc0NN` the NNth community.)

export const SEED_USER_ID = "e2e00000-0000-4000-8000-0000000ee001";
export const SEED_EMAIL = "e2e-realtime@e2e.invalid";
export const SEED_USER_NAME = "E2E Realtime Member";

/** At most one community per sidebar slot that stays live (SIDEBAR_REALTIME_LIMIT). */
export const MAX_SEED_COMMUNITIES = 15;

export function clampSeedCommunities(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_SEED_COMMUNITIES, n);
}

export function seedCommunityId(index) {
  return `e2e00000-0000-4000-8000-0000000cc0${String(index).padStart(2, "0")}`;
}

export function seedCommunityName(index) {
  return `E2E realtime ${index}`;
}

/** 32 hex chars, the shape the app's own invite tokens have; unique per index. */
export function inviteTokenFor(index) {
  return `e2e${String(index).padStart(2, "0")}${"0".repeat(27)}`;
}

export function seedCommunityIds(count) {
  return Array.from({ length: clampSeedCommunities(count) }, (_, i) => seedCommunityId(i + 1));
}

// ── Target resolution ───────────────────────────────────────────────────────

export function isLoopbackHost(host) {
  const name = String(host).replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

export function readEnvFile(file) {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Where the rows would go. Environment first, then the app's own .env.local —
 * the same precedence the dev server itself uses.
 */
export function resolveSeedTarget({ env = process.env, envText = "" } = {}) {
  const fromFile = envText ? parseDevVars(envText) : {};
  const supabaseUrl = String(env.SUPABASE_URL || fromFile.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || fromFile.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl) {
    throw new Error(
      "no target database: set SUPABASE_URL, or keep NEXT_PUBLIC_SUPABASE_URL in apps/web/.env.local",
    );
  }

  let host;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    throw new Error(`target database is not an http(s) URL: ${supabaseUrl}`);
  }

  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceKey, host, local: isLoopbackHost(host) };
}

/** The reason seeding must not run, or null when it may. */
export function remoteSeedRefusal(target, env = process.env) {
  if (target.local || env.E2E_SEED_ALLOW_REMOTE === "1") return null;
  return (
    `refusing to write into ${target.host}: it is not a local database. The seeder inserts a member, ` +
    "its communities and their memberships into whatever project apps/web/.env.local points at, which is " +
    "usually the shared project the deployed app uses. Re-run with E2E_SEED_ALLOW_REMOTE=1 to allow it — " +
    "the rows are removed again when the run finishes."
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

function openSeedDb(target) {
  if (!target.serviceKey) {
    throw new Error(
      "no service-role key: set SUPABASE_SERVICE_ROLE_KEY, or keep it in apps/web/.env.local — " +
        "the seeder writes straight into the database the app reads",
    );
  }
  return createClient(target.supabaseUrl, target.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const fail = (action, error) => new Error(`could not ${action}: ${error?.message ?? error}`);

/** Delete every row a seed could have written. Safe to run on its own. */
async function clearSeedRows(db, log) {
  const communityIds = seedCommunityIds(MAX_SEED_COMMUNITIES);

  const { data: communities, error: communitiesError } = await db
    .from("communities")
    .delete()
    .in("id", communityIds)
    .select("id");
  if (communitiesError) throw fail("delete the seeded communities", communitiesError);

  // By id AND by email: a run that changed the identity, or a manual probe,
  // must not leave the address behind to trip the unique constraint.
  const { data: users, error: userError } = await db
    .from("users")
    .delete()
    .or(`id.eq.${SEED_USER_ID},email.eq.${SEED_EMAIL}`)
    .select("id");
  if (userError) throw fail("delete the seeded member", userError);

  // The rows PostgREST reports as deleted, not just "the request succeeded": a
  // filter that matches nothing is a clean-looking no-op, and a test that
  // asserts its own cleanup has to be able to tell the two apart.
  const removed = { users: users?.length ?? 0, communities: communities?.length ?? 0 };
  log(
    removed.users || removed.communities
      ? `removed ${removed.users} seeded member(s) and ${removed.communities} seeded community(ies)`
      : "nothing seeded to remove",
  );

  return { userId: SEED_USER_ID, communityIds, removed };
}

export async function clearSeed({ target, log = () => {} }) {
  return clearSeedRows(openSeedDb(target), log);
}

/**
 * Create the member and `communities` private communities it owns, and join it
 * to them. Idempotent: a previous seed of these ids is cleared first.
 */
export async function seedMember({ target, communities = 1, log = () => {} }) {
  const communityIds = seedCommunityIds(communities);
  const db = openSeedDb(target);

  // Start from a clean slate so a re-run cannot collide on a unique key and a
  // killed run cannot leave a half-seeded member (or an orphan community) behind.
  await clearSeedRows(db, () => {});

  // A valid bcrypt hash of a secret this process throws away: the column is NOT
  // NULL and the login path bcrypt-compares against it, so it must be a real
  // hash — but there is no password that opens this account.
  const passwordHash = await bcrypt.hash(randomBytes(24).toString("base64url"), 10);

  const { error: userError } = await db.from("users").insert({
    id: SEED_USER_ID,
    name: SEED_USER_NAME,
    email: SEED_EMAIL,
    password_hash: passwordHash,
    is_blocked: false,
  });
  if (userError) throw fail("create the seeded member", userError);

  // NO designer_profiles row, and that is deliberate: the dashboard's one-time
  // repair auto-joins any member whose profile has picks (city, sector,
  // experience level, job title) into the real communities for those values —
  // creating them when they are missing — so a seeded profile would edit shared
  // data far beyond the rows above. A missing profile skips that repair, and the
  // dashboard shell reads it with maybeSingle(), so it renders anyway.

  const { error: communitiesError } = await db.from("communities").insert(
    communityIds.map((id, index) => ({
      id,
      name: seedCommunityName(index + 1),
      description: null,
      // A member-led community ("user"), which is how the app creates one and
      // the only kind the sidebar keeps without a master-data reference.
      type: "user",
      reference_id: null,
      image_url: null,
      owner_id: SEED_USER_ID,
      // Private: it must never read as a joinable community to anyone else
      // while it exists in a shared project.
      is_private: true,
      invite_token: inviteTokenFor(index + 1),
      enabled_tabs: ["chat", "threads", "events", "resources"],
      is_active: true,
    })),
  );
  if (communitiesError) throw fail("create the seeded communities", communitiesError);

  const { error: membersError } = await db.from("community_members").insert(
    communityIds.map((community_id) => ({ community_id, user_id: SEED_USER_ID, role: "owner" })),
  );
  if (membersError) throw fail("join the seeded member to its communities", membersError);

  log(`seeded ${SEED_EMAIL} (${SEED_USER_ID}) with ${communityIds.length} private community(ies)`);
  return { userId: SEED_USER_ID, communityIds };
}

// ── Standalone use ──────────────────────────────────────────────────────────

function parseArgv(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    communities: clampSeedCommunities(value("--communities") ?? 1),
    cleanup: argv.includes("--cleanup"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(argv) {
  const flags = parseArgv(argv);
  const target = resolveSeedTarget({ envText: readEnvFile(WEB_ENV_FILE) });

  console.log(`E2E member seed → ${target.supabaseUrl} (${target.local ? "local" : "shared/remote"})`);

  if (flags.dryRun) {
    console.log(`  would write: 1 member, ${flags.communities} community(ies), ${flags.communities} membership(s)`);
    console.log(`  ids: ${[SEED_USER_ID, ...seedCommunityIds(flags.communities)].join(", ")}`);
    const refusal = remoteSeedRefusal(target);
    console.log(refusal ? `  refused: ${refusal}` : "  allowed (local target, or E2E_SEED_ALLOW_REMOTE=1)");
    return;
  }

  if (flags.cleanup) {
    await clearSeed({ target, log: (line) => console.log(`  ${line}`) });
    return;
  }

  const refusal = remoteSeedRefusal(target);
  if (refusal) throw new Error(refusal);

  await seedMember({ target, communities: flags.communities, log: (line) => console.log(`  ${line}`) });
  console.log("  remove them again with: node apps/web/e2e/seed-member.mjs --cleanup");
}

// Only when run as a program — the browser test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\nE2E member seed failed: ${error.message}\n`);
    process.exit(1);
  });
}
