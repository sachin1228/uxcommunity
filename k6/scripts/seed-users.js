#!/usr/bin/env node
/**
 * k6/scripts/seed-users.js
 *
 * Creates N test users directly in Supabase (bypassing the invite flow),
 * adds them all to a community, then writes their credentials to the local,
 * gitignored fixture k6/data/test-users.json so the k6 concurrent chat and
 * flood scenarios can act as a different real user per VU.
 *
 * The fixture is derived, not source: it holds plaintext passwords and
 * pre-signed session JWTs, so it is never committed (see `k6/data/*.json` in
 * .gitignore). Re-running the seeder is idempotent — existing users are reused
 * and only their local fixture entry is refreshed.
 *
 * Run from the project root:
 *   npm run k6:seed
 *
 * Required env vars:
 *   SUPABASE_URL               — Supabase project URL of the target environment
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (never expose to clients)
 *   TEST_COMMUNITY_ID          — UUID of the community to join users into
 *   SESSION_SECRET             — the target environment's JWT signing secret,
 *                                so the pre-signed sessions are accepted there
 *
 * Optional env vars:
 *   K6_USER_COUNT    — how many test users to create (default: 200)
 *   K6_USER_PASSWORD — password for all test users. When unset the seeder
 *                      reuses the password in the existing local fixture, or
 *                      generates a random one for new users.
 *   K6_USER_PREFIX   — email prefix, e.g. "k6user" → k6user_0001@k6test.invalid
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FIXTURE_PATH, buildFixture } from '../lib/fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

// ── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMUNITY_ID    = process.env.TEST_COMMUNITY_ID;
const SESSION_SECRET  = process.env.SESSION_SECRET;
const USER_COUNT      = parseInt(process.env.K6_USER_COUNT    || '200', 10);
const PREFIX          = process.env.K6_USER_PREFIX            || 'k6user';

if (!SUPABASE_URL || !SERVICE_KEY || !COMMUNITY_ID || !SESSION_SECRET) {
  console.error(`
ERROR: Missing required environment variables.

  SUPABASE_URL               — ${SUPABASE_URL    ? '✓' : '✗ MISSING'}
  SUPABASE_SERVICE_ROLE_KEY  — ${SERVICE_KEY     ? '✓' : '✗ MISSING'}
  TEST_COMMUNITY_ID          — ${COMMUNITY_ID    ? '✓' : '✗ MISSING'}
  SESSION_SECRET             — ${SESSION_SECRET  ? '✓' : '✗ MISSING'}

SESSION_SECRET must be the same secret the target environment uses, otherwise
the generated session cookies are rejected there.

Usage:
  SUPABASE_URL=https://xxx.supabase.co \\
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
  TEST_COMMUNITY_ID=<uuid> \\
  SESSION_SECRET=your-secret \\
  npm run k6:seed
`);
  process.exit(1);
}

/** Generate a 7-day JWT session token — identical to what the app creates on login. */
async function createSessionToken(userId, email) {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({ userId, email, role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'test-users.json');
const BATCH_SIZE  = 50; // insert in batches to avoid request size limits

// ── Helpers ────────────────────────────────────────────────────────────────
function pad(n, width = 4) {
  return String(n).padStart(width, '0');
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function readExistingFixture() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Pick the password for the seeded accounts — never a committed default:
 *   1. K6_USER_PASSWORD, when the operator set one;
 *   2. the password already recorded in the local fixture, so re-seeding keeps
 *      working logins;
 *   3. a fresh random password for this run.
 */
function resolvePassword() {
  const fromEnv = process.env.K6_USER_PASSWORD;
  if (fromEnv) return { password: fromEnv, source: 'K6_USER_PASSWORD' };

  const reusable = readExistingFixture().find(
    (user) => user && typeof user.password === 'string' && user.password.length > 0,
  );
  if (reusable) return { password: reusable.password, source: `existing ${FIXTURE_PATH}` };

  return { password: randomBytes(24).toString('base64url'), source: 'generated' };
}

/**
 * Never write the credentials file into a tracked path. `git check-ignore`
 * exits 0 when the path is ignored and 1 when it is not.
 */
function assertFixtureIsIgnored() {
  const result = spawnSync('git', ['check-ignore', '-q', FIXTURE_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  if (result.error) {
    console.warn(`   ! Could not run git to confirm ${FIXTURE_PATH} is ignored: ${result.error.message}\n`);
    return;
  }

  if (result.status === 1) {
    console.error(`
ERROR: ${FIXTURE_PATH} is not gitignored, so this run would leave credentials in git.

  Restore the rule in .gitignore:

    # k6 load-test credentials (generated locally by npm run k6:seed)
    k6/data/*.json

  Nothing was written.
`);
    process.exit(1);
  }
}

// ── Fetch existing seeded users (skip already-created ones) ────────────────
async function fetchExistingEmails() {
  const { data } = await db
    .from('users')
    .select('email')
    .like('email', `${PREFIX}_%@k6test.invalid`);
  return new Set((data || []).map((r) => r.email));
}

// ── Fetch valid experience level values ─────────────────────────────────────
async function getExperienceLevel() {
  const { data } = await db
    .from('experience_levels')
    .select('value')
    .limit(1);
  return data?.[0]?.value || 'mid';
}

/**
 * Existing seeded users keep whatever hash they were created with. Verify the
 * current password still matches it and re-hash when it does not, so the local
 * fixture never advertises a password that cannot log in.
 */
async function syncPasswordHashes(userIds, password, passwordHash) {
  if (userIds.length === 0) return;

  let rehashed = 0;

  for (let b = 0; b < userIds.length; b += BATCH_SIZE) {
    const batch = userIds.slice(b, b + BATCH_SIZE);
    const { data, error } = await db
      .from('users')
      .select('id, password_hash')
      .in('id', batch);

    if (error) {
      console.error(`   ✗ Could not read existing password hashes: ${error.message}`);
      continue;
    }

    const stale = [];
    for (const row of data || []) {
      const matches = row.password_hash
        ? await bcrypt.compare(password, row.password_hash)
        : false;
      if (!matches) stale.push(row.id);
    }

    if (stale.length === 0) continue;

    const { error: updateError } = await db
      .from('users')
      .update({ password_hash: passwordHash })
      .in('id', stale);

    if (updateError) {
      console.error(`   ✗ Password re-hash error: ${updateError.message}`);
    } else {
      rehashed += stale.length;
    }
  }

  if (rehashed > 0) {
    console.log(`   ✓ Re-hashed ${rehashed} existing users to this run's password.\n`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  Seeding ${USER_COUNT} test users into community ${COMMUNITY_ID}\n`);

  assertFixtureIsIgnored();

  const { password: PASSWORD, source: passwordSource } = resolvePassword();
  console.log(`   Password source: ${passwordSource}\n`);

  const existingEmails = await fetchExistingEmails();
  console.log(`   Found ${existingEmails.size} already-seeded users — skipping those.\n`);

  const experienceLevel = await getExperienceLevel();

  const passwordHash = await hashPassword(PASSWORD);
  console.log(`   Password hash generated.\n`);

  const allUsers   = [];
  const toCreate   = [];

  for (let i = 1; i <= USER_COUNT; i++) {
    const email = `${PREFIX}_${pad(i)}@k6test.invalid`;
    const name  = `k6 Test User ${pad(i)}`;
    allUsers.push({ email, name, password: PASSWORD });
    if (!existingEmails.has(email)) {
      toCreate.push({ email, name });
    }
  }

  console.log(`   ${toCreate.length} new users to create.\n`);

  // ── Insert users in batches ────────────────────────────────────────────────
  const createdUserIds = {}; // email → id

  for (let b = 0; b < toCreate.length; b += BATCH_SIZE) {
    const batch = toCreate.slice(b, b + BATCH_SIZE);
    const rows  = batch.map(({ email, name }) => ({
      name,
      email,
      password_hash: passwordHash,
      is_blocked:    false,
    }));

    const { data, error } = await db
      .from('users')
      .insert(rows)
      .select('id, email');

    if (error) {
      console.error(`   ✗ Failed inserting user batch ${b}–${b + BATCH_SIZE}:`, error.message);
      continue;
    }

    for (const u of data) createdUserIds[u.email] = u.id;
    process.stdout.write(`   Inserted users ${b + 1}–${Math.min(b + BATCH_SIZE, toCreate.length)} / ${toCreate.length}\r`);
  }
  console.log(`\n   ✓ ${Object.keys(createdUserIds).length} new users inserted.\n`);

  const newlyCreatedIds = new Set(Object.values(createdUserIds));

  // ── Fetch IDs for already-existing users ─────────────────────────────────
  const existingEmails2 = [...existingEmails].filter(e => e.startsWith(PREFIX));
  if (existingEmails2.length > 0) {
    for (let b = 0; b < existingEmails2.length; b += BATCH_SIZE) {
      const batch = existingEmails2.slice(b, b + BATCH_SIZE);
      const { data } = await db
        .from('users')
        .select('id, email')
        .in('email', batch);
      for (const u of data || []) createdUserIds[u.email] = u.id;
    }
  }

  // ── Create designer_profiles (required for login) ────────────────────────
  const allIds        = Object.values(createdUserIds);
  // Test users intentionally have no profile picture. This exercises the same
  // initials fallback used for members who skip the optional upload.
  const existingProfileIds = new Set();
  for (let b = 0; b < allIds.length; b += BATCH_SIZE) {
    const batch = allIds.slice(b, b + BATCH_SIZE);
    const { data } = await db
      .from('designer_profiles')
      .select('user_id')
      .in('user_id', batch);
    for (const profile of data || []) existingProfileIds.add(profile.user_id);
  }

  const profilesNeeded = allIds.filter(id => !existingProfileIds.has(id));
  console.log(`   ${profilesNeeded.length} profiles to create.\n`);

  for (let b = 0; b < profilesNeeded.length; b += BATCH_SIZE) {
    const batch = profilesNeeded.slice(b, b + BATCH_SIZE);
    const rows = batch.map(id => ({
      user_id: id,
      experience_level: experienceLevel,
    }));

    const { error } = await db.from('designer_profiles').insert(rows);
    if (error) {
      console.error(`   ✗ Profile batch ${b} error:`, error.message);
    } else {
      process.stdout.write(`   Created profiles ${b + 1}–${Math.min(b + BATCH_SIZE, profilesNeeded.length)} / ${profilesNeeded.length}\r`);
    }
  }
  console.log(`\n   ✓ Profiles done.\n`);

  // ── Join all users to the community ─────────────────────────────────────
  const { data: existingMembers } = await db
    .from('community_members')
    .select('user_id')
    .eq('community_id', COMMUNITY_ID)
    .in('user_id', allIds);

  const existingMemberIds = new Set((existingMembers || []).map(m => m.user_id));
  const membersNeeded     = allIds.filter(id => !existingMemberIds.has(id));

  console.log(`   ${membersNeeded.length} users need community membership.\n`);

  for (let b = 0; b < membersNeeded.length; b += BATCH_SIZE) {
    const batch = membersNeeded.slice(b, b + BATCH_SIZE);
    const rows  = batch.map(id => ({
      community_id: COMMUNITY_ID,
      user_id:      id,
    }));

    const { error } = await db.from('community_members').insert(rows);
    if (error) {
      console.error(`   ✗ Membership batch ${b} error:`, error.message);
    } else {
      process.stdout.write(`   Joined ${b + 1}–${Math.min(b + BATCH_SIZE, membersNeeded.length)} / ${membersNeeded.length}\r`);
    }
  }
  console.log(`\n   ✓ Community memberships done.\n`);

  // ── Keep reused users' logins working with this run's password ───────────
  const existingIds = allIds.filter(id => !newlyCreatedIds.has(id));
  await syncPasswordHashes(existingIds, PASSWORD, passwordHash);

  // ── Generate session tokens for every user ───────────────────────────────
  console.log('   Generating session tokens...\n');
  const emailToId = {};
  // Fetch IDs for all seeded users
  for (let b = 0; b < allUsers.length; b += BATCH_SIZE) {
    const batch = allUsers.slice(b, b + BATCH_SIZE).map(u => u.email);
    const { data } = await db.from('users').select('id, email').in('email', batch);
    for (const u of data || []) emailToId[u.email] = u.id;
  }

  const entries = [];
  for (const u of allUsers) {
    const userId = emailToId[u.email];
    if (!userId) continue;
    const sessionToken = await createSessionToken(userId, u.email);
    entries.push({
      email:        u.email,
      password:     PASSWORD,
      name:         u.name,
      userId,
      sessionToken, // pre-signed JWT — k6 sets this as uxcommunity_session cookie
    });
  }

  // Validate before writing: never leave a fixture with an empty
  // password/session behind.
  const output = buildFixture(entries);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`   ✓ ${output.length} session tokens generated.\n`);
  console.log(`✅  Done! ${output.length} users written to the local, gitignored file:\n    ${OUTPUT_FILE}\n`);
  console.log(`   Run the chat load test:\n`);
  console.log(`   k6 run k6/scenarios/chat_concurrent.js \\`);
  console.log(`     -e BASE_URL=https://your-app.example \\`);
  console.log(`     -e TEST_COMMUNITY_ID=${COMMUNITY_ID}\n`);
  console.log(`   Remove the users again with: npm run k6:cleanup\n`);
}

main().catch(err => {
  console.error('\n✗ Seeder failed:', err.message);
  process.exit(1);
});
