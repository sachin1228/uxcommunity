import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { masterDataSchema } from "@/lib/validations";
import { z } from "zod";
import { cleanupMasterDataMedia, collectMasterMediaUrls } from "@/lib/r2-cleanup";
import { syncMasterImageToCommunities } from "@/lib/master-data/mirror-image";

const patchSchema = masterDataSchema
  .extend({ is_active: z.boolean().optional() })
  .partial();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db
    .from("design_sectors")
    .select("id, name, image_url, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to fetch sector." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Sector not found." }, { status: 404 });
  return NextResponse.json({ sector: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }
  const db = createServiceClient();

  // A new picture replaces the old one everywhere the master row is mirrored,
  // so read the outgoing URL first — after the update it is gone, and with it
  // the only pointer that could reclaim the object from R2.
  const changesImage = parsed.data.image_url !== undefined;
  const previousImageUrl = changesImage
    ? (await db.from("design_sectors").select("image_url").eq("id", id).maybeSingle())
        .data?.image_url ?? null
    : null;

  const { data, error } = await db
    .from("design_sectors")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A sector with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to update sector." }, { status: 500 });
  }

  // `communities.image_url` mirrors this row, so write the new picture (or the
  // cleared null) through to every linked community — the read path resolves
  // the master row, and leaving the column behind keeps the replaced object
  // referenced forever.
  let communitiesMirrored: number | null = null;
  if (changesImage) {
    communitiesMirrored = (
      await syncMasterImageToCommunities({
        db,
        table: "design_sectors",
        masterId: id,
        imageUrl: parsed.data.image_url ?? null,
        previousImageUrl,
      })
    ).mirrored;
  }

  revalidateTag("master-images", {});
  return NextResponse.json({
    sector: data,
    ...(communitiesMirrored !== null ? { communities_mirrored: communitiesMirrored } : {}),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  // Collect every R2 URL the master row + its communities own BEFORE deleting
  // (the rows are unrecoverable afterwards).
  const urls = await collectMasterMediaUrls(db, "sector", "design_sectors", id);

  // Delete the master row first; only clean up the community if that succeeds.
  const { error } = await db.from("design_sectors").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Cannot delete: this sector is linked to one or more designer profiles. Deactivate it instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to delete sector." }, { status: 500 });
  }

  // Master row is gone — remove the linked communities (the orphan filter in
  // /api/communities/all hides them from users immediately) and clean up every
  // R2 object they owned. Best-effort: failures surface in logs and are
  // re-run any time via the admin orphan scan (Tools → R2 storage health).
  try {
    const cleanup = await cleanupMasterDataMedia(db, "sector", "design_sectors", id, urls);
    if (cleanup.failed.length > 0) {
      console.error("[admin/sectors] R2 cleanup failures:", cleanup.failed);
    }
    return NextResponse.json({ success: true, r2: { deleted: cleanup.deleted.length, skipped: cleanup.skipped.length, failed: cleanup.failed.length } });
  } catch (cleanupError) {
    console.error("[admin/sectors] R2 cleanup error:", cleanupError);
    return NextResponse.json({ success: true, r2: { error: "R2 cleanup failed; orphan scan will retry." } });
  }
}
