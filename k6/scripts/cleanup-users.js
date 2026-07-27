#!/usr/bin/env node
/**
 * k6/scripts/cleanup-users.js
 *
 * Removes all seeded test users (those with @k6test.invalid emails) from
 * Supabase. Cascades to designer_profiles, community_members, messages, etc.
 * Also deletes k6/data/test-users.json.
 *
 * Run from the project root:
 *   node k6/scripts/cleanup-users.js
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   K6_USER_PREFIX — defaults to "k6user"
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREFIX       = process.env.K6_USER_PREFIX || 'k6user';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log(`\n🧹  Cleaning up k6 test users (${PREFIX}_*@k6test.invalid)...\n`);

  // Fetch all seeded user IDs
  const { data: users, error } = await db
    .from('users')
    .select('id, email')
    .like('email', `${PREFIX}_%@k6test.invalid`);

  if (error) {
    console.error('✗ Failed to fetch users:', error.message);
    process.exit(1);
  }

  if (!users || users.length === 0) {
    console.log('   No seeded users found — nothing to clean up.\n');
  } else {
    console.log(`   Found ${users.length} users to delete.\n`);

    const ids = users.map(u => u.id);
    const BATCH_SIZE = 100;

    for (let b = 0; b < ids.length; b += BATCH_SIZE) {
      const batch = ids.slice(b, b + BATCH_SIZE);
      const { error: delErr } = await db
        .from('users')
        .delete()
        .in('id', batch);

      if (delErr) {
        console.error(`   ✗ Delete batch ${b} error:`, delErr.message);
      } else {
        process.stdout.write(`   Deleted ${Math.min(b + BATCH_SIZE, ids.length)} / ${ids.length}\r`);
      }
    }
    console.log(`\n   ✓ ${users.length} users deleted (cascades to profiles, members, messages).\n`);
  }

  // Remove the credentials file
  const outputFile = path.join(__dirname, '..', 'data', 'test-users.json');
  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
    console.log(`   ✓ Deleted ${outputFile}\n`);
  }

  console.log('✅  Cleanup complete.\n');
}

main().catch(err => {
  console.error('\n✗ Cleanup failed:', err.message);
  process.exit(1);
});
