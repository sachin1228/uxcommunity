import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced, uploadToR2 } from "@/lib/r2";
import { MASTER_IMAGE_LOOKUPS } from "@/lib/r2-cleanup";
import { extensionForMime } from "@/lib/image-utils";
import { shouldAutoFetchImage } from "@/lib/master-data/eligibility";
import { MASTER_TABLES, type MasterTable } from "@/lib/master-data/master-tables";
import { findWikipediaImage } from "@/lib/master-data/wikipedia-image";

const TABLES: Record<MasterTable, { table: string }> = {
  cities: { table: "cities" },
  design_sectors: { table: "design_sectors" },
  design_interests: { table: "design_interests" },
  experience_levels: { table: "experience_levels" },
};

function isMasterTable(value: unknown): value is MasterTable {
  return typeof value === "string" && (MASTER_TABLES as readonly string[]).includes(value);
}

// The repo's untyped supabase-js client resolves table rows/updates to `never`
// (pre-existing repo-wide baseline). Cast results to the actual shape so this
// route stays type-clean.
interface MasterRow {
  id: string;
  name: string;
  image_url: string | null;
}

/**
 * GET — lists which rows would be updated (and which are skipped) so the
 * admin UI can show a confirmation preview before touching anything.
 */
export async function GET(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const table = request.nextUrl.searchParams.get("table");
  if (!isMasterTable(table)) {
    return NextResponse.json({ error: "table is required." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from(TABLES[table].table)
    .select("id, name, image_url")
    .order("name")
    .limit(500);

  if (error) return NextResponse.json({ error: "Failed to fetch items." }, { status: 500 });

  const rows = (data ?? []) as MasterRow[];
  const eligible: Array<{ id: string; name: string; image_url: string | null }> = [];
  const skipped: Array<{ id: string; name: string }> = [];
  for (const row of rows) {
    if (shouldAutoFetchImage(row.name)) {
      eligible.push({ id: row.id, name: row.name, image_url: row.image_url });
    } else {
      skipped.push({ id: row.id, name: row.name });
    }
  }

  return NextResponse.json({ eligible, skipped });
}

/**
 * POST — fetch a Wikipedia image for a single master-data row, upload it to
 * R2, and attach it to the row. The admin UI loops over eligible rows one at
 * a time so progress is visible per row; each row is updated independently,
 * so a failure for one never blocks the rest.
 */
export async function POST(request: NextRequest) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const body = (await request.json().catch(() => ({}))) as { table?: unknown; itemId?: unknown };
  if (!isMasterTable(body.table)) {
    return NextResponse.json({ error: "table is required." }, { status: 400 });
  }
  if (typeof body.itemId !== "string" || !body.itemId.trim()) {
    return NextResponse.json({ error: "itemId is required." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: item, error: itemError } = await db
    .from(TABLES[body.table].table)
    .select("id, name, image_url")
    .eq("id", body.itemId)
    .maybeSingle();

  if (itemError) return NextResponse.json({ error: "Failed to fetch item." }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });
  const row = item as MasterRow;
  if (!shouldAutoFetchImage(row.name)) {
    return NextResponse.json(
      { ok: false, error: `"${row.name}" is excluded from image fetching.` },
      { status: 422 }
    );
  }

  const image = await findWikipediaImage(row.name);
  if (!image) {
    return NextResponse.json({
      ok: false,
      error: `No Wikipedia image found for "${row.name}".`,
    });
  }

  const ext = extensionForMime(image.contentType);
  const key = `master-data/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  let url: string;
  try {
    url = await uploadToR2(key, image.bytes, image.contentType);
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to upload image." });
  }

  const { data: updated, error: updateError } = await db
    .from(TABLES[body.table].table)
    // Cast matches the client's broken `never` payload type (repo baseline).
    .update({ image_url: url } as never)
    .eq("id", row.id)
    .select("id, name, image_url, is_active, created_at, updated_at")
    .single();

  if (updateError || !updated) {
    // DB write failed — don't leave the freshly uploaded object behind.
    try {
      await deleteR2AssetIfUnreferenced(db, url, MASTER_IMAGE_LOOKUPS);
    } catch (cleanupError) {
      console.error("[fetch-images] failed-upload cleanup error:", cleanupError);
    }
    return NextResponse.json({ ok: false, error: "Failed to save image on item." });
  }

  // The replacement succeeded — delete the previous image unless another row
  // (community mirror or another master row) still references it.
  if (row.image_url && row.image_url !== url) {
    try {
      await deleteR2AssetIfUnreferenced(db, row.image_url, MASTER_IMAGE_LOOKUPS);
    } catch (cleanupError) {
      console.error("[fetch-images] replaced-image cleanup error:", cleanupError);
    }
  }

  revalidateTag("master-images", {});
  return NextResponse.json({ ok: true, item: updated });
}