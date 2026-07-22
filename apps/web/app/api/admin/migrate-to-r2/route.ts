/**
 * POST /api/admin/migrate-to-r2
 *
 * One-time backfill: downloads every image that still lives in Supabase Storage
 * (identified by a supabase.co URL), uploads it to R2, and updates the DB row.
 *
 * Safe to run multiple times — rows already pointing at R2 are skipped.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { uploadToR2, parseR2Key } from "@/lib/r2";

const MASTER_TABLES: { table: string; column: string }[] = [
  { table: "companies",         column: "image_url" },
  { table: "cities",            column: "image_url" },
  { table: "design_sectors",    column: "image_url" },
  { table: "design_interests",  column: "image_url" },
  { table: "experience_levels", column: "image_url" },
  { table: "communities",       column: "image_url" },
];

export interface MigrateResult {
  id: string | null;
  table: string;
  oldUrl: string;
  newUrl: string | null;
  status: "migrated" | "skipped" | "failed";
  reason?: string;
}

function isSupabaseUrl(url: string): boolean {
  return url.includes(".supabase.co/storage/");
}

/** Derive an R2 key prefix from the Supabase storage path. */
function deriveR2Key(url: string, table: string, id: string | null): string {
  try {
    // Supabase path: /storage/v1/object/public/<bucket>/<...storagePath>
    const match = new URL(url).pathname.match(
      /^\/storage\/v1\/object\/public\/[^/]+\/(.+)$/
    );
    const storagePath = match?.[1] ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Prefix by table so objects stay organised in R2
    if (table === "designer_profiles") {
      return `avatars/${storagePath}`;
    }
    if (storagePath.startsWith("lottie/")) {
      return storagePath; // keep lottie/ prefix
    }
    return `master-data/${storagePath}`;
  } catch {
    return `master-data/${table}/${id ?? "unknown"}-${Date.now()}`;
  }
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function guessContentType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png":  return "image/png";
    case "webp": return "image/webp";
    case "svg":  return "image/svg+xml";
    case "json": return "application/json";
    default:     return "image/jpeg";
  }
}

export async function POST() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const results: MigrateResult[] = [];

  // ── 1. Master-data + community tables ──────────────────────────────────────
  for (const { table, column } of MASTER_TABLES) {
    const { data: rows, error } = await db
      .from(table)
      .select(`id, ${column}`)
      .not(column, "is", null);

    if (error) {
      console.error(`[migrate-to-r2] Failed to fetch ${table}:`, error);
      continue;
    }

    for (const row of (rows ?? []) as unknown as Record<string, string | null>[]) {
      const url: string | null = row[column];
      if (!url) continue;

      // Already in R2 — skip
      if (parseR2Key(url)) {
        results.push({ id: row.id, table, oldUrl: url, newUrl: null, status: "skipped", reason: "already in R2" });
        continue;
      }

      // Not a Supabase URL — leave it alone
      if (!isSupabaseUrl(url)) {
        results.push({ id: row.id, table, oldUrl: url, newUrl: null, status: "skipped", reason: "external URL" });
        continue;
      }

      try {
        const buffer = await fetchBuffer(url);
        const key = deriveR2Key(url, table, row.id);
        const newUrl = await uploadToR2(key, buffer, guessContentType(url));

        const { error: patchErr } = await db.from(table).update({ [column]: newUrl }).eq("id", row.id);
        if (patchErr) throw new Error(patchErr.message);

        results.push({ id: row.id, table, oldUrl: url, newUrl, status: "migrated" });
      } catch (err) {
        console.error(`[migrate-to-r2] ${table}/${row.id}:`, err);
        results.push({ id: row.id, table, oldUrl: url, newUrl: null, status: "failed", reason: String(err) });
      }
    }
  }

  // ── 2. User avatars (uploaded only) ────────────────────────────────────────
  const { data: profiles, error: profileErr } = await db
    .from("designer_profiles")
    .select("user_id, avatar_url")
    .eq("avatar_source", "upload")
    .not("avatar_url", "is", null);

  if (profileErr) {
    console.error("[migrate-to-r2] Failed to fetch designer_profiles:", profileErr);
  } else {
    for (const profile of (profiles ?? [])) {
      const url: string | null = profile.avatar_url;
      if (!url) continue;

      if (parseR2Key(url)) {
        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl: null, status: "skipped", reason: "already in R2" });
        continue;
      }

      if (!isSupabaseUrl(url)) {
        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl: null, status: "skipped", reason: "external URL" });
        continue;
      }

      try {
        const buffer = await fetchBuffer(url);
        const key = deriveR2Key(url, "designer_profiles", profile.user_id);
        const newUrl = await uploadToR2(key, buffer, guessContentType(url));

        const { error: patchErr } = await db
          .from("designer_profiles")
          .update({ avatar_url: newUrl })
          .eq("user_id", profile.user_id);
        if (patchErr) throw new Error(patchErr.message);

        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl, status: "migrated" });
      } catch (err) {
        console.error(`[migrate-to-r2] designer_profiles/${profile.user_id}:`, err);
        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl: null, status: "failed", reason: String(err) });
      }
    }
  }

  const migrated = results.filter((r) => r.status === "migrated").length;
  const skipped  = results.filter((r) => r.status === "skipped").length;
  const failed   = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({ migrated, skipped, failed, total: results.length, results });
}
