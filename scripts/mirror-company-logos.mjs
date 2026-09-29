/**
 * Mirrors company logos into R2.
 *
 * Every company whose domain is known can show a logo without anyone
 * uploading one: the app derives an icon URL from the domain at render time
 * (see apps/web/lib/companies/logos.ts). That is fine for a first paint, but
 * it means every visitor's browser asks a third party for the icon of every
 * company row on the page.
 *
 * This script removes that dependency: it fetches each company's icon once,
 * stores it in the bucket the rest of the app already uses, and writes the
 * resulting URL to `companies.logo_url`. The stored image then wins over the
 * derived one automatically.
 *
 * Run from the repo root, with the same env the app uses:
 *
 *   node scripts/mirror-company-logos.mjs            # fetch and store
 *   node scripts/mirror-company-logos.mjs --dry-run  # fetch and report only
 *   node scripts/mirror-company-logos.mjs --limit 25 # first 25 companies
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 * R2_PUBLIC_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Safe to re-run: a company that already has a logo_url is skipped unless
 * --force is passed, and a failed upload is logged rather than fatal.
 *
 * The provider below is the same one the app derives from; keep the two in
 * step if it is ever changed.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const PROVIDER = "https://www.google.com/s2/favicons";
const SIZE = 128;
const REQUEST_TIMEOUT_MS = 10_000;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const limitFlag = process.argv.indexOf("--limit");
const limit = limitFlag === -1 ? Infinity : Number(process.argv[limitFlag + 1]) || Infinity;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PUBLIC_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
const BUCKET = process.env.R2_BUCKET_NAME ?? "";

function missingEnv() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
  ];
  return required.filter((name) => !process.env[name]);
}

const missing = missingEnv();
// A dry run still needs to reach the database, but never the bucket.
if (missing.length > 0 && !(dryRun && missing.every((name) => name.startsWith("R2_")))) {
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

/**
 * Every company with a domain that the app would derive a logo for: the
 * verified domain when there is one, else the directory hint. `company_domains`
 * is the only place a domain lives, so the query joins through it and prefers
 * verified rows the way `search_companies` does.
 */
async function companiesNeedingLogos() {
  const query = new URLSearchParams({
    select: "id,name,slug,logo_url,company_domains(domain,verified)",
    "company_domains.domain": "not.is.null",
    order: "name.asc",
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/companies?${query}`, { headers });
  if (!res.ok) throw new Error(`GET companies: ${res.status} ${await res.text()}`);

  const rows = await res.json();
  return rows
    .map((row) => {
      const domains = [...(row.company_domains ?? [])].sort(
        (a, b) => Number(b.verified) - Number(a.verified) || a.domain.localeCompare(b.domain)
      );
      return { ...row, domain: domains[0]?.domain ?? null };
    })
    .filter((row) => row.domain && (force || !row.logo_url));
}

/** Fetches the icon, or null when the provider has none for this domain. */
async function fetchLogo(domain) {
  const url = `${PROVIDER}?domain=${encodeURIComponent(domain)}&sz=${SIZE}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  // A domain the provider does not know answers 404 — an ordinary outcome, and
  // the reason CompanyLogo is allowed to fall back to the company's initial.
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!contentType.startsWith("image/")) return null;

  const body = Buffer.from(await res.arrayBuffer());
  if (body.length === 0) return null;

  return { body, contentType };
}

function extensionFor(contentType) {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/jpeg":
      return "jpg";
    default:
      return "ico";
  }
}

async function upload(key, body, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Keys carry a timestamp, so a URL never points at different bytes.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return `${PUBLIC_BASE}/${key}`;
}

async function saveLogoUrl(id, logoUrl) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ logo_url: logoUrl }),
  });
  if (!res.ok) throw new Error(`PATCH companies/${id}: ${res.status} ${await res.text()}`);
}

const all = await companiesNeedingLogos();
const work = all.slice(0, limit === Infinity ? all.length : limit);

console.log(
  `${work.length} of ${all.length} companies have a domain and no stored logo` +
    (dryRun ? " (dry run)" : "")
);

let stored = 0;
let skipped = 0;
let failed = 0;

for (const company of work) {
  try {
    const logo = await fetchLogo(company.domain);
    if (!logo) {
      console.log(`  –  ${company.name} (${company.domain}): provider has no icon`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  ?  ${company.name} (${company.domain}): ${logo.contentType}, ${logo.body.length} bytes`);
      stored++;
      continue;
    }

    const key = `companies/logos/${company.slug}-${Date.now()}.${extensionFor(logo.contentType)}`;
    const url = await upload(key, logo.body, logo.contentType);
    await saveLogoUrl(company.id, url);
    console.log(`  ✓  ${company.name} → ${url}`);
    stored++;
  } catch (error) {
    console.error(`  ✗  ${company.name} (${company.domain}): ${error.message}`);
    failed++;
  }
}

console.log(`\nDone: ${stored} ${dryRun ? "available" : "stored"}, ${skipped} without an icon, ${failed} failed.`);
