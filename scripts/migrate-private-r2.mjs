#!/usr/bin/env node

/**
 * Move existing public-bucket documents into the private bucket.
 *
 * DEFAULT IS READ-ONLY. This script never touches production unless an
 * operator explicitly runs it with the apply/purge flags against their own
 * credentials. It is not wired into CI or the deploy workflow.
 *
 *   node scripts/migrate-private-r2.mjs
 *     Build and print the plan. No R2 write, no DB write.
 *
 *   node scripts/migrate-private-r2.mjs --apply
 *     For every planned object: copy public → private, download the private
 *     copy back, compare SHA-256 and size, THEN update the row's key column.
 *     The public URL stays in place, so a failed copy never breaks a link.
 *     Writes a local state file under tmp/ for the purge phase.
 *
 *   node scripts/migrate-private-r2.mjs --purge-public --confirm-purge
 *     Delete the public copy only when (a) the private copy exists, (b) the
 *     database no longer references the public URL, and (c) no DM report
 *     snapshot still carries it. Emits a local purge-list file under tmp/ — the list
 *     to hand to a Cloudflare cache purge, because an immutable CDN copy can
 *     outlive the origin object.
 *
 * Environment: same files as scripts/verify-r2-credentials.mjs, plus
 * SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL and
 * R2_PRIVATE_BUCKET_NAME.
 */

import { requireLocalDatabase, requireLocalStorage } from "./environments/maintenance.mjs";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import {
  dmProxyPathFromKey,
  extensionFromKey,
  legacyKeyFromPublicUrl,
  ownerIdFromKey,
  privateCategory,
  targetKeyFor,
} from "./migrate-private-r2-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILES = [
  path.join(ROOT, "apps", "web", ".dev.vars"),
  path.join(ROOT, "apps", "web", ".env.local"),
  path.join(ROOT, "apps", "web", ".env"),
];
const STATE_PATH = path.join(ROOT, "tmp", "private-r2-migration-state.json");
const PURGE_LIST_PATH = path.join(ROOT, "tmp", "private-r2-purge-urls.txt");
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const PURGE = args.has("--purge-public");
const CONFIRM_PURGE = args.has("--confirm-purge");

function loadEnv() {
  const values = { ...process.env };
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (values[key] !== undefined && values[key] !== "") continue;
      values[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

function required(values, name) {
  const value = values[name];
  if (!value) {
    console.error(`Missing ${name}. Set it in the environment or apps/web/.dev.vars.`);
    process.exit(2);
  }
  return value;
}

function makeClients(values) {
  requireLocalDatabase(values.NEXT_PUBLIC_SUPABASE_URL);
  requireLocalStorage(values);
  const endpoint = values.R2_ENDPOINT;
  const credentials = {
    accessKeyId: required(values, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(values, "R2_SECRET_ACCESS_KEY"),
  };
  return {
    s3: new S3Client({ region: "auto", endpoint, forcePathStyle: true, credentials }),
    publicBucket: required(values, "R2_BUCKET_NAME"),
    // Only apply/purge need the private bucket; a read-only plan can run
    // before the bucket exists.
    privateBucket: values.R2_PRIVATE_BUCKET_NAME ?? "",
    publicBase: required(values, "R2_PUBLIC_URL").replace(/\/+$/, ""),
    supabase: createClient(
      required(values, "NEXT_PUBLIC_SUPABASE_URL"),
      required(values, "SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    ),
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readObject(s3, bucket, key) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`empty body for ${key}`);
  const bytes = Buffer.from(await response.Body.transformToByteArray());
  if (bytes.byteLength > MAX_OBJECT_BYTES) {
    throw new Error(`${key} is larger than ${MAX_OBJECT_BYTES} bytes`);
  }
  return { bytes, contentType: response.ContentType ?? "application/octet-stream" };
}

async function exists(s3, bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// ── Plan ────────────────────────────────────────────────────────────────────

function addEntry(plan, { category, ownerId, sourceKey, sourceUrl, ref }) {
  if (!category || !ownerId) return false;
  let entry = plan.get(sourceKey);
  if (!entry) {
    entry = {
      category,
      ownerId,
      sourceKey,
      sourceUrl,
      targetKey: targetKeyFor(category, ownerId, extensionFromKey(sourceKey), randomUUID()),
      refs: [],
    };
    plan.set(sourceKey, entry);
  }
  entry.refs.push(ref);
  return true;
}

async function buildPlan({ supabase, publicBase }) {
  const plan = new Map();
  const skipped = [];

  const [resumes, applications, verifications, messages] = await Promise.all([
    supabase
      .from("member_resumes")
      .select("id, user_id, url, storage_key")
      .is("storage_key", null)
      .not("url", "is", null),
    supabase
      .from("job_applications")
      .select("id, applicant_id, resume_url, resume_key")
      .is("resume_key", null)
      .not("resume_url", "is", null),
    supabase
      .from("account_verification_requests")
      .select("id, user_id, work_sample_urls, work_sample_keys"),
    supabase
      .from("dm_messages")
      .select("id, conversation_id, image_url, image_key")
      .is("image_key", null)
      .not("image_url", "is", null),
  ]);

  for (const [label, result] of Object.entries({
    member_resumes: resumes,
    job_applications: applications,
    account_verification_requests: verifications,
    dm_messages: messages,
  })) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }

  for (const row of resumes.data ?? []) {
    const key = legacyKeyFromPublicUrl(row.url, publicBase);
    if (!key || privateCategory(key) !== "resumes") {
      skipped.push({ table: "member_resumes", id: row.id, reason: "not a public resume URL" });
      continue;
    }
    addEntry(plan, {
      category: "resumes",
      ownerId: row.user_id,
      sourceKey: key,
      sourceUrl: row.url,
      ref: { table: "member_resumes", id: row.id, field: "storage_key" },
    });
  }

  for (const row of applications.data ?? []) {
    const key = legacyKeyFromPublicUrl(row.resume_url, publicBase);
    if (!key || privateCategory(key) !== "resumes") {
      skipped.push({ table: "job_applications", id: row.id, reason: "not a public resume URL" });
      continue;
    }
    addEntry(plan, {
      category: "resumes",
      ownerId: row.applicant_id,
      sourceKey: key,
      sourceUrl: row.resume_url,
      ref: { table: "job_applications", id: row.id, field: "resume_key" },
    });
  }

  for (const row of verifications.data ?? []) {
    if ((row.work_sample_keys ?? []).length > 0) continue;
    for (const url of row.work_sample_urls ?? []) {
      const key = legacyKeyFromPublicUrl(url, publicBase);
      if (!key || privateCategory(key) !== "verification") {
        skipped.push({ table: "account_verification_requests", id: row.id, reason: "not a public sample URL" });
        continue;
      }
      addEntry(plan, {
        category: "verification",
        ownerId: row.user_id,
        sourceKey: key,
        sourceUrl: url,
        ref: { table: "account_verification_requests", id: row.id, field: "work_sample_keys" },
      });
    }
  }

  for (const row of messages.data ?? []) {
    const key = legacyKeyFromPublicUrl(row.image_url, publicBase);
    if (!key || privateCategory(key) !== "dm") {
      // GIPHY and other external images are not ours to migrate.
      continue;
    }
    addEntry(plan, {
      category: "dm",
      ownerId: ownerIdFromKey(key) ?? row.conversation_id,
      sourceKey: key,
      sourceUrl: row.image_url,
      ref: { table: "dm_messages", id: row.id, field: "image_key" },
    });
  }

  return { entries: [...plan.values()], skipped };
}

// ── Apply ───────────────────────────────────────────────────────────────────

async function copyVerified({ s3, publicBucket, privateBucket }, entry) {
  const { bytes, contentType } = await readObject(s3, publicBucket, entry.sourceKey);
  const sourceHash = sha256(bytes);

  if (await exists(s3, privateBucket, entry.targetKey)) {
    const existing = await readObject(s3, privateBucket, entry.targetKey);
    if (sha256(existing.bytes) === sourceHash) return { bytes: bytes.byteLength };
    throw new Error(`target ${entry.targetKey} already exists with different bytes`);
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: privateBucket,
      Key: entry.targetKey,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "private, no-store",
    }),
  );

  const copied = await readObject(s3, privateBucket, entry.targetKey);
  if (sha256(copied.bytes) !== sourceHash || copied.bytes.byteLength !== bytes.byteLength) {
    throw new Error(`verification failed for ${entry.targetKey}`);
  }
  return { bytes: bytes.byteLength };
}

async function updateVerificationRow(supabase, id, targetBySource) {
  const { data, error } = await supabase
    .from("account_verification_requests")
    .select("id, work_sample_urls, work_sample_keys")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(`verification ${id}: ${error?.message ?? "not found"}`);
  const urls = data.work_sample_urls ?? [];
  const keys = urls.map((url, index) => targetBySource.get(url) ?? data.work_sample_keys?.[index] ?? null);
  const { error: updateError } = await supabase
    .from("account_verification_requests")
    .update({ work_sample_keys: keys.filter(Boolean) })
    .eq("id", id);
  if (updateError) throw new Error(`verification ${id} update: ${updateError.message}`);
}

async function applyEntry(clients, entry, targetBySource) {
  const copied = await copyVerified(clients, entry);
  const { supabase } = clients;

  for (const ref of entry.refs) {
    if (ref.table === "member_resumes") {
      const { error } = await supabase
        .from("member_resumes")
        .update({ storage_key: entry.targetKey })
        .eq("id", ref.id);
      if (error) throw new Error(`member_resumes ${ref.id}: ${error.message}`);
    } else if (ref.table === "job_applications") {
      const { error } = await supabase
        .from("job_applications")
        .update({ resume_key: entry.targetKey })
        .eq("id", ref.id);
      if (error) throw new Error(`job_applications ${ref.id}: ${error.message}`);
    } else if (ref.table === "account_verification_requests") {
      await updateVerificationRow(supabase, ref.id, targetBySource);
    } else if (ref.table === "dm_messages") {
      const proxyPath = dmProxyPathFromKey(entry.targetKey);
      if (!proxyPath) throw new Error(`cannot derive DM path for ${entry.targetKey}`);
      const { error } = await supabase
        .from("dm_messages")
        .update({ image_key: entry.targetKey, image_url: proxyPath })
        .eq("id", ref.id);
      if (error) throw new Error(`dm_messages ${ref.id}: ${error.message}`);
    }
  }

  // Moderation evidence is self-contained: rewrite the snapshot's old public
  // URL to the new authorization-gated path, so the admin queue keeps working
  // after the public copy is purged.
  if (entry.category === "dm") {
    const proxyPath = dmProxyPathFromKey(entry.targetKey);
    const { data: reports, error } = await supabase
      .from("dm_reports")
      .select("id, message_snapshot");
    if (error) throw new Error(`dm_reports read: ${error.message}`);
    for (const report of reports ?? []) {
      const snapshot = report.message_snapshot;
      if (!Array.isArray(snapshot)) continue;
      let changed = false;
      const next = snapshot.map((message) => {
        if (message?.image_url !== entry.sourceUrl) return message;
        changed = true;
        return { ...message, image_url: proxyPath };
      });
      if (!changed) continue;
      const { error: updateError } = await supabase
        .from("dm_reports")
        .update({ message_snapshot: next })
        .eq("id", report.id);
      if (updateError) throw new Error(`dm_reports ${report.id}: ${updateError.message}`);
    }
  }

  return copied;
}

// ── Purge ───────────────────────────────────────────────────────────────────

/**
 * Drop the legacy URL columns that point at a verified private copy. This is
 * the "update application references" half: the key was already written and
 * verified, so the public locator is no longer needed. Anything still pointing
 * at the source URL (a row created after the plan, a report snapshot) keeps
 * the object alive — the purge check below refuses to delete it.
 */
async function detachLegacyUrl(clients, entry) {
  const { supabase } = clients;
  for (const ref of entry.refs) {
    if (ref.table === "member_resumes") {
      const { error } = await supabase
        .from("member_resumes")
        .update({ url: null })
        .eq("id", ref.id)
        .eq("storage_key", entry.targetKey);
      if (error) throw new Error(`member_resumes ${ref.id} detach: ${error.message}`);
    } else if (ref.table === "job_applications") {
      const { error } = await supabase
        .from("job_applications")
        .update({ resume_url: null })
        .eq("id", ref.id)
        .eq("resume_key", entry.targetKey);
      if (error) throw new Error(`job_applications ${ref.id} detach: ${error.message}`);
    } else if (ref.table === "account_verification_requests") {
      const { error } = await supabase
        .from("account_verification_requests")
        .update({ work_sample_urls: [] })
        .eq("id", ref.id)
        .contains("work_sample_keys", [entry.targetKey]);
      if (error) throw new Error(`verification ${ref.id} detach: ${error.message}`);
    }
    // dm_messages.image_url was rewritten to the proxy path during apply.
  }
}

async function sourceStillReferenced(clients, entry) {
  const { supabase } = clients;
  const checks = await Promise.all([
    supabase.from("member_resumes").select("id").eq("url", entry.sourceUrl).limit(1),
    supabase.from("job_applications").select("id").eq("resume_url", entry.sourceUrl).limit(1),
    supabase
      .from("account_verification_requests")
      .select("id")
      .contains("work_sample_urls", [entry.sourceUrl])
      .limit(1),
    supabase.from("dm_messages").select("id").eq("image_url", entry.sourceUrl).limit(1),
  ]);
  for (const result of checks) {
    if (result.error) return { referenced: true, reason: result.error.message };
    if ((result.data ?? []).length > 0) return { referenced: true, reason: "row still points at the public URL" };
  }

  const { data: reports, error } = await clients.supabase
    .from("dm_reports")
    .select("id, message_snapshot");
  if (error) return { referenced: true, reason: `report read: ${error.message}` };
  const stillInReport = (reports ?? []).some((report) =>
    JSON.stringify(report.message_snapshot ?? []).includes(entry.sourceUrl),
  );
  if (stillInReport) return { referenced: true, reason: "report snapshot still carries the public URL" };
  return { referenced: false, reason: null };
}

async function purgeEntry(clients, entry, manifest) {
  const targetExists = await exists(clients.s3, clients.privateBucket, entry.targetKey);
  if (!targetExists) return { ok: false, reason: "private copy missing" };

  try {
    await detachLegacyUrl(clients, entry);
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  const reference = await sourceStillReferenced(clients, entry);
  if (reference.referenced) return { ok: false, reason: reference.reason };

  await clients.s3.send(
    new DeleteObjectCommand({ Bucket: clients.publicBucket, Key: entry.sourceKey }),
  );
  manifest.push(entry.sourceUrl);
  return { ok: true, reason: null };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const clients = makeClients(loadEnv());

  if ((APPLY || PURGE) && !clients.privateBucket) {
    console.error("R2_PRIVATE_BUCKET_NAME is required for --apply and --purge-public.");
    process.exit(2);
  }

  if (PURGE) {
    if (!CONFIRM_PURGE) {
      console.error("Refusing to purge without --confirm-purge.");
      process.exit(2);
    }
    if (!existsSync(STATE_PATH)) {
      console.error(`No migration state at ${STATE_PATH}. Run --apply first.`);
      process.exit(2);
    }
    const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    const manifest = [];
    let deleted = 0;
    let kept = 0;
    for (const entry of state.entries) {
      const outcome = await purgeEntry(clients, entry, manifest);
      if (outcome.ok) {
        deleted += 1;
        console.log(`purged ${entry.sourceKey}`);
      } else {
        kept += 1;
        console.warn(`kept ${entry.sourceKey}: ${outcome.reason}`);
      }
    }
    mkdirSync(path.dirname(PURGE_LIST_PATH), { recursive: true });
    writeFileSync(PURGE_LIST_PATH, `${manifest.join("\n")}\n`);
    console.log(`\nPurged ${deleted}, kept ${kept}.`);
    console.log(`Purge list: ${PURGE_LIST_PATH}`);
    console.warn(
      "R2 objects served through an immutable custom domain may still be at the CDN edge. " +
        "Purge these URLs in Cloudflare (Caching → Purge by URL) before considering the move complete.",
    );
    return;
  }

  const { entries, skipped } = await buildPlan(clients);
  const references = entries.reduce((sum, entry) => sum + entry.refs.length, 0);
  console.log(`Plan: ${entries.length} object(s), ${references} database reference(s).`);
  for (const entry of entries) {
    console.log(`  ${entry.category}: ${entry.sourceKey} → ${entry.targetKey} (${entry.refs.length} ref)`);
  }
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} row(s):`);
    for (const item of skipped.slice(0, 50)) {
      console.log(`  ${item.table} ${item.id}: ${item.reason}`);
    }
  }
  if (!APPLY) {
    console.log("\nRead-only plan. Re-run with --apply to copy and verify.");
    return;
  }
  if (!entries.length) {
    console.log("\nNothing to migrate.");
    return;
  }

  const targetBySource = new Map(entries.map((entry) => [entry.sourceUrl, entry.targetKey]));
  // Keep entries from earlier runs (a re-run skips rows that already have a
  // key, and its purge phase still needs their source URLs).
  const done = [];
  if (existsSync(STATE_PATH)) {
    try {
      const previous = JSON.parse(readFileSync(STATE_PATH, "utf8"));
      if (Array.isArray(previous.entries)) done.push(...previous.entries);
    } catch {
      console.warn(`Could not read ${STATE_PATH}; starting a new state file.`);
    }
  }
  const flushState = () => {
    mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    writeFileSync(
      STATE_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), entries: done }, null, 2),
    );
  };

  for (const entry of entries) {
    try {
      const result = await applyEntry(clients, entry, targetBySource);
      if (!done.some((saved) => saved.sourceKey === entry.sourceKey)) done.push(entry);
      flushState();
      console.log(`migrated ${entry.sourceKey} (${Math.round(result.bytes / 1024)} KB)`);
    } catch (error) {
      console.error(`FAILED ${entry.sourceKey}: ${error.message} — public copy kept`);
    }
  }

  flushState();
  console.log(`\nMigrated ${entries.length} planned object(s); ${done.length} total in state. State: ${STATE_PATH}`);
  console.log("Public copies are untouched. Run --purge-public --confirm-purge after verification.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
