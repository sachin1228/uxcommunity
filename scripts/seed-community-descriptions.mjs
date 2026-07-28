/**
 * Fills in auto-generated descriptions for communities that have none.
 * Auto-created communities (interest, city, company, sector, experience_level)
 * are born with NULL description because the source tables have no description
 * column. This script backfills sensible defaults.
 *
 * Run from repo root (requires env vars):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-community-descriptions.mjs
 *
 * Or just paste the SQL below into your Supabase dashboard SQL editor.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// Fetch communities without descriptions
const { data: communities, error } = await db
  .from("communities")
  .select("id, name, type, description")
  .or("description.is.null,description.eq.");

if (error) {
  console.error("Fetch error:", error.message);
  process.exit(1);
}

console.log(`Found ${communities.length} communities without descriptions.`);
if (!communities.length) {
  console.log("Nothing to update.");
  process.exit(0);
}

function makeDescription(type, name) {
  switch (type) {
    case "interest":
      return `A community for ${name} enthusiasts and professionals. Share work, get feedback, and grow together.`;
    case "city":
      return `Connect with designers based in ${name}. Local meetups, jobs, and conversations.`;
    case "company":
      return `A space for designers at ${name} to share ideas, resources, and support each other.`;
    case "sector":
      return `Designers working in the ${name} industry. Discuss trends, tools, and opportunities.`;
    case "experience_level":
      return `A community for ${name}. Peer support, career advice, and shared learning.`;
    case "general":
      return `${name} — an open community for designers everywhere.`;
    case "user":
      return `${name} — a member-led community.`;
    default:
      return `${name} — a community for designers.`;
  }
}

let updated = 0;
let failed  = 0;

for (const c of communities) {
  const description = makeDescription(c.type, c.name);
  const { error: updateError } = await db
    .from("communities")
    .update({ description })
    .eq("id", c.id);

  if (updateError) {
    console.error(`  ✗ ${c.name}: ${updateError.message}`);
    failed++;
  } else {
    console.log(`  ✓ ${c.name} (${c.type})`);
    updated++;
  }
}

console.log(`\nDone. ${updated} updated, ${failed} failed.`);
