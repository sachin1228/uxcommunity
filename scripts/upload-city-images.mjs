/**
 * Uploads generated city images to R2 and updates image_url in Supabase.
 * Run from repo root: node scripts/upload-city-images.mjs
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

const CITIES_DIR = resolve("attached_assets/cities");

// City filename → DB name mapping
const FILE_TO_NAME = {
  "amsterdam.jpg":     "Amsterdam",
  "austin.jpg":        "Austin",
  "barcelona.jpg":     "Barcelona",
  "berlin.jpg":        "Berlin",
  "dubai.jpg":         "Dubai",
  "lisbon.jpg":        "Lisbon",
  "london.jpg":        "London",
  "los-angeles.jpg":   "Los Angeles",
  "melbourne.jpg":     "Melbourne",
  "new-york-city.jpg": "New York City",
  "paris.jpg":         "Paris",
  "san-francisco.jpg": "San Francisco",
  "seattle.jpg":       "Seattle",
  "seoul.jpg":         "Seoul",
  "singapore.jpg":     "Singapore",
  "stockholm.jpg":     "Stockholm",
  "sydney.jpg":        "Sydney",
  "são-paulo.jpg":     "São Paulo",
  "tokyo.jpg":         "Tokyo",
  "toronto.jpg":       "Toronto",
};

// ── R2 client ──────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

// ── Supabase REST helpers (no WebSocket needed) ────────────────────────────
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sbGet(table, select = "*") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${table}: ${await res.text()}`);
  return res.json();
}

async function sbPatch(table, id, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table}/${id}: ${await res.text()}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function uploadToR2(key, buf) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buf,
    ContentType: "image/jpeg",
  }));
  return `${PUBLIC_BASE}/${key}`;
}

// ── Main ───────────────────────────────────────────────────────────────────
const files = readdirSync(CITIES_DIR).filter(f => f.endsWith(".jpg"));

// Fetch all cities from DB once
const allCities = await sbGet("cities", "id,name,image_url");
const cityMap = Object.fromEntries(allCities.map(c => [c.name, c]));

let ok = 0, skip = 0, fail = 0;

for (const file of files) {
  const cityName = FILE_TO_NAME[file];
  if (!cityName) { console.warn(`  ⚠ No mapping for ${file}, skipping`); skip++; continue; }

  const city = cityMap[cityName];
  if (!city) { console.warn(`  ⚠ "${cityName}" not in DB yet, skipping`); skip++; continue; }

  const key = `master-data/cities/${Date.now()}-${file}`;
  const buf = readFileSync(join(CITIES_DIR, file));

  try {
    const url = await uploadToR2(key, buf);

    await sbPatch("cities", city.id, { image_url: url });

    console.log(`  ✓ ${cityName} → ${url}`);
    ok++;
  } catch (err) {
    console.error(`  ✗ ${cityName}: ${err.message}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} uploaded, ${skip} skipped, ${fail} failed.`);
