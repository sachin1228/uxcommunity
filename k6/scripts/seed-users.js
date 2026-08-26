#!/usr/bin/env node
/**
 * k6/scripts/seed-users.js
 *
 * Creates N test users directly in Supabase (bypassing the invite flow),
 * adds them all to a community, then writes their credentials to
 * k6/data/test-users.json so the k6 concurrent chat scenario can log in
 * as each one independently.
 *
 * Run from the project root:
 *   node k6/scripts/seed-users.js
 *
 * Required env vars:
 *   SUPABASE_URL               — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (never expose to clients)
 *   TEST_COMMUNITY_ID          — UUID of the community to join users into
 *
 * Optional env vars:
 *   K6_USER_COUNT    — how many test users to create (default: 200)
 *   K6_USER_PASSWORD — plain-text password for all test users (default: K6testPass123!)
 *   K6_USER_PREFIX   — email prefix, e.g. "k6user" → k6user_001@k6test.invalid
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMUNITY_ID    = process.env.TEST_COMMUNITY_ID;
const SESSION_SECRET  = process.env.SESSION_SECRET;
const USER_COUNT      = parseInt(process.env.K6_USER_COUNT    || '200', 10);
const PASSWORD        = process.env.K6_USER_PASSWORD          || 'K6testPass123!';
const PREFIX          = process.env.K6_USER_PREFIX            || 'k6user';

if (!SUPABASE_URL || !SERVICE_KEY || !COMMUNITY_ID || !SESSION_SECRET) {
  console.error(`
ERROR: Missing required environment variables.

  SUPABASE_URL               — ${SUPABASE_URL    ? '✓' : '✗ MISSING'}
  SUPABASE_SERVICE_ROLE_KEY  — ${SERVICE_KEY     ? '✓' : '✗ MISSING'}
  TEST_COMMUNITY_ID          — ${COMMUNITY_ID    ? '✓' : '✗ MISSING'}
  SESSION_SECRET             — ${SESSION_SECRET  ? '✓' : '✗ MISSING'}

Usage:
  SUPABASE_URL=https://xxx.supabase.co \\
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
  TEST_COMMUNITY_ID=<uuid> \\
  SESSION_SECRET=your-secret \\
  node k6/scripts/seed-users.js
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

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀  Seeding ${USER_COUNT} test users into community ${COMMUNITY_ID}\n`);

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

  // ── Insert users in batches ──���───────────────────────────────────────────
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

  // ── Generate session tokens for every user ───────────────────────────────
  console.log('   Generating session tokens...\n');
  const emailToId = {};
  // Fetch IDs for all seeded users
  for (let b = 0; b < allUsers.length; b += BATCH_SIZE) {
    const batch = allUsers.slice(b, b + BATCH_SIZE).map(u => u.email);
    const { data } = await db.from('users').select('id, email').in('email', batch);
    for (const u of data || []) emailToId[u.email] = u.id;
  }

  const output = [];
  for (const u of allUsers) {
    const userId = emailToId[u.email];
    if (!userId) continue;
    const sessionToken = await createSessionToken(userId, u.email);
    output.push({
      email:        u.email,
      password:     PASSWORD,
      name:         u.name,
      userId,
      sessionToken, // pre-signed JWT — k6 sets this as uxcommunity_session cookie
    });
  }
  console.log(`   ✓ ${output.length} session tokens generated.\n`);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`✅  Done! ${output.length} users written to:\n    ${OUTPUT_FILE}\n`);
  console.log(`   Run the chat load test:\n`);
  console.log(`   k6 run k6/scenarios/chat_concurrent.js \\`);
  console.log(`     -e BASE_URL=https://your-app.vercel.app \\`);
  console.log(`     -e TEST_COMMUNITY_ID=${COMMUNITY_ID}\n`);
}

main().catch(err => {
  console.error('\n✗ Seeder failed:', err.message);
  process.exit(1);
});
