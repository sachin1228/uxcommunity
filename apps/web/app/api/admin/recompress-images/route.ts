import { NextResponse } from "next/server";
import sharp from "sharp";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { uploadToR2, downloadFromR2, deleteFromR2, parseR2Key } from "@/lib/r2";

const TARGET_SIZE = 300;
const JPEG_QUALITY = 78; // matches client-side compressImage

/** Tables that store raster images in R2. */
const MASTER_TABLES: { table: string; column: string; responseKey: string }[] = [
  { table: "companies",         column: "image_url",  responseKey: "companies"         },
  { table: "cities",            column: "image_url",  responseKey: "cities"            },
  { table: "design_sectors",    column: "image_url",  responseKey: "design_sectors"    },
  { table: "design_interests",  column: "image_url",  responseKey: "design_interests"  },
  { table: "experience_levels", column: "image_url",  responseKey: "experience_levels" },
];

/** Compress a buffer to a 300×300 center-cropped JPEG.
 *  Returns null when the image is already at the target size (already compressed). */
async function compressBuffer(input: Buffer): Promise<Buffer | null> {
  const meta = await sharp(input).metadata();
  const { width = 0, height = 0, format } = meta;

  // Skip SVGs (sharp can't reliably handle them) and already-compressed images.
  if (format === "svg") return null;
  if (width === TARGET_SIZE && height === TARGET_SIZE) return null; // already done

  return sharp(input)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "center" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

export interface RecompressResult {
  id: string | null;
  table: string;
  oldUrl: string;
  newUrl: string | null;
  status: "compressed" | "skipped" | "failed";
  reason?: string;
}

export async function POST() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();
  const results: RecompressResult[] = [];

  // ── 1. Master-data tables ──────────────────────────────────────────────────
  for (const { table, column } of MASTER_TABLES) {
    const { data: rows, error } = await db
      .from(table)
      .select(`id, ${column}`)
      .not(column, "is", null);

    if (error) {
      console.error(`[recompress] Failed to fetch ${table}:`, error);
      continue;
    }

    for (const row of (rows ?? []) as unknown as Record<string, string | null>[]) {
      const url: string | null = row[column];
      if (!url) continue;

      const key = parseR2Key(url);
      if (!key) {
        results.push({ id: row.id, table, oldUrl: url, newUrl: null, status: "skipped", reason: "external URL" });
        continue;
      }

      try {
        const original = await downloadFromR2(key);
        const compressed = await compressBuffer(original);

        if (!compressed) {
          results.push({ id: row.id, table, oldUrl: url, newUrl: null, status: "skipped", reason: "already 300×300 or SVG" });
          continue;
        }

        // Upload with a new key so we never overwrite while readers may still load the old URL.
        const newKey = `master-data/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const newUrl = await uploadToR2(newKey, compressed, "image/jpeg");

        const { error: patchErr } = await db.from(table).update({ [column]: newUrl }).eq("id", row.id);
        if (patchErr) throw new Error(patchErr.message);

        // Remove old file (best-effort — don't fail the whole batch on this).
        await deleteFromR2(key).catch(() => {});

        results.push({ id: row.id, table, oldUrl: url, newUrl, status: "compressed" });
      } catch (err) {
        console.error(`[recompress] ${table}/${row.id}:`, err);
        results.push({ id: row.id, table, oldUrl: url, newUrl: null, status: "failed", reason: String(err) });
      }
    }
  }

  // ── 2. User avatars (uploaded only) ───────────────────────────────────────
  const { data: profiles, error: profileErr } = await db
    .from("designer_profiles")
    .select("user_id, avatar_url")
    .eq("avatar_source", "upload")
    .not("avatar_url", "is", null);

  if (profileErr) {
    console.error("[recompress] Failed to fetch designer_profiles:", profileErr);
  } else {
    for (const profile of (profiles ?? [])) {
      const url: string | null = profile.avatar_url;
      if (!url) continue;

      const key = parseR2Key(url);
      if (!key) {
        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl: null, status: "skipped", reason: "external URL" });
        continue;
      }

      try {
        const original = await downloadFromR2(key);
        const compressed = await compressBuffer(original);

        if (!compressed) {
          results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl: null, status: "skipped", reason: "already 300×300 or SVG" });
          continue;
        }

        const newKey = `avatars/${profile.user_id}/${Date.now()}.jpg`;
        const newUrl = await uploadToR2(newKey, compressed, "image/jpeg");

        const { error: patchErr } = await db
          .from("designer_profiles")
          .update({ avatar_url: newUrl })
          .eq("user_id", profile.user_id);
        if (patchErr) throw new Error(patchErr.message);

        await deleteFromR2(key).catch(() => {});

        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl, status: "compressed" });
      } catch (err) {
        console.error(`[recompress] designer_profiles/${profile.user_id}:`, err);
        results.push({ id: profile.user_id, table: "designer_profiles", oldUrl: url, newUrl: null, status: "failed", reason: String(err) });
      }
    }
  }

  const compressed = results.filter((r) => r.status === "compressed").length;
  const skipped    = results.filter((r) => r.status === "skipped").length;
  const failed     = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({ compressed, skipped, failed, total: results.length, results });
}
