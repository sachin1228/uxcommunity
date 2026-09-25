import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteFromR2, deleteOwnedR2AssetIfUnique, deleteR2AssetIfUnreferenced, shouldDeletePreviousR2Asset, uploadToR2 } from "@/lib/r2";
import { resolveCommunityDp } from "@/lib/communities/dp";
import type { Database } from "@/lib/supabase/database.types";

const MAX_IMAGE_BYTES  = 5 * 1024 * 1024; // 5 MB — same as master-data uploads
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

const MASTER_TABLE: Record<string, { table: string; idCol: string }> = {
  city:             { table: "cities",            idCol: "id" },
  sector:           { table: "design_sectors",    idCol: "id" },
  interest:         { table: "design_interests",  idCol: "id" },
  experience_level: { table: "experience_levels", idCol: "id" },
  job_title:        { table: "job_titles",        idCol: "id" },
};

const DP_REFERENCE_LOOKUPS = [
  { table: "communities", column: "image_url" },
  { table: "communities", column: "lottie_url" },
  { table: "cities", column: "image_url" },
  { table: "cities", column: "lottie_url" },
  { table: "design_sectors", column: "image_url" },
  { table: "design_sectors", column: "lottie_url" },
  { table: "design_interests", column: "image_url" },
  { table: "design_interests", column: "lottie_url" },
  { table: "experience_levels", column: "image_url" },
  { table: "experience_levels", column: "lottie_url" },
  { table: "job_titles", column: "image_url" },
  { table: "job_titles", column: "lottie_url" },
];

// ── POST /api/admin/communities/[id]/dp ──────────────────────────────────────
// Replaces the static display picture of an APP-CREATED community
// (owner_id IS NULL) with an uploaded image. Animated (Lottie) display
// pictures were removed; uploading an image also clears any legacy animation
// reference. The change is mirrored onto the linked master-data row, so it
// propagates everywhere the app resolves master images.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const { data: community, error } = await db
    .from("communities")
    .select("id, name, type, reference_id, owner_id, image_url, lottie_url, lottie_format")
    .eq("id", id)
    .maybeSingle();
  if (error || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  // Member-led communities own their picture in-app; only platform
  // communities can have it replaced here. Keyed off the type, so a
  // member-led community that lost its owner is still treated as member-led.
  if (community.type === "user") {
    return NextResponse.json(
      { error: "Only app-created communities can replace the display picture." },
      { status: 422 }
    );
  }

  let formData: FormData;
  try { formData = await request.formData(); } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const kind = formData.get("kind");
  const file = formData.get("file");
  if (kind !== "image") {
    return NextResponse.json({ error: "kind must be \"image\"." }, { status: 422 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  let uploadKey: string;
  let contentType: string;

  {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP and SVG images are allowed." },
        { status: 422 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 422 });
    }
    const ext = file.name.split(".").pop() ?? "jpg";
    uploadKey = `communities/${id}/dp-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    contentType = file.type;
  }

  const communityUpdate: Database["public"]["Tables"]["communities"]["Update"] = {};
  // The master row lives in whichever master table the community mirrors
  // (MASTER_TABLE), so this patch stays a plain record.
  const masterUpdate: Record<string, string | null> = {};

  let url: string;
  try {
    url = await uploadToR2(uploadKey, Buffer.from(await file.arrayBuffer()), contentType);
  } catch (err) {
    console.error("[community-dp] R2 upload error:", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  if (kind === "image") {
    communityUpdate.image_url = url;
    masterUpdate.image_url = url;
    // Animated DPs are retired: an image upload also clears any legacy
    // animation reference on the community (and its master row).
    communityUpdate.lottie_url = null;
    communityUpdate.lottie_format = null;
    masterUpdate.lottie_url = null;
    masterUpdate.lottie_format = null;
  }

  const { error: communityError } = await db
    .from("communities")
    .update(communityUpdate)
    .eq("id", id);
  if (communityError) {
    // The upload already succeeded — remove it so a failed save doesn't leave
    // an unreferenced R2 object.
    try {
      await deleteFromR2(uploadKey);
    } catch (cleanupError) {
      console.error("[community-dp] failed-save upload cleanup error:", cleanupError);
    }
    console.error("[community-dp] community update failed:", communityError);
    return NextResponse.json({ error: "Failed to save display picture." }, { status: 500 });
  }

  // Mirror onto the linked master-data row so the change propagates everywhere.
  let master_synced = false;
  const lookup = MASTER_TABLE[community.type];
  if (lookup && community.reference_id) {
    const { error: masterError } = await db
      .from(lookup.table as any)
      .update(masterUpdate)
      .eq(lookup.idCol, community.reference_id);
    master_synced = !masterError;
    if (masterError) console.error("[community-dp] master row sync failed:", masterError);
  }

  const previousUrl = community.image_url;
  if ((!lookup || master_synced) && shouldDeletePreviousR2Asset(previousUrl, url) && previousUrl) {
    await deleteOwnedR2AssetIfUnique(db, previousUrl, DP_REFERENCE_LOOKUPS);
  }

  revalidateTag("master-images", {});

  const dp = await resolveCommunityDp({
    type: community.type,
    reference_id: community.reference_id,
    image_url: communityUpdate.image_url ?? community.image_url ?? null,
  });

  return NextResponse.json({
    community: {
      id: community.id,
      name: community.name,
      image_url: dp.image_url,
      lottie_url: null,
      lottie_format: null,
      lottie_data: null,
    },
    master_synced,
  });
}

// ── DELETE /api/admin/communities/[id]/dp ────────────────────────────────────
// Removes the lottie animation from an app-created community (and its master
// row), falling back to the static image.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const { data: community, error } = await db
    .from("communities")
    .select("id, name, type, reference_id, owner_id, image_url, lottie_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (community.type === "user") {
    return NextResponse.json(
      { error: "Only app-created communities can change the display picture." },
      { status: 422 }
    );
  }

  const previousLottieUrl = community.lottie_url ?? null;
  const { error: communityError } = await db
    .from("communities")
    .update({ lottie_url: null, lottie_format: null })
    .eq("id", id);
  if (communityError) {
    return NextResponse.json({ error: "Failed to remove animation." }, { status: 500 });
  }

  let master_synced = false;
  const lookup = MASTER_TABLE[community.type];
  if (lookup && community.reference_id) {
    const { error: masterError } = await db
      .from(lookup.table as any)
      .update({ lottie_url: null, lottie_format: null })
      .eq(lookup.idCol, community.reference_id);
    master_synced = !masterError;
  }

  if ((!lookup || master_synced) && previousLottieUrl) {
    await deleteR2AssetIfUnreferenced(db, previousLottieUrl, [
      { table: "communities", column: "lottie_url" },
      { table: "cities", column: "lottie_url" },
      { table: "design_sectors", column: "lottie_url" },
      { table: "design_interests", column: "lottie_url" },
      { table: "experience_levels", column: "lottie_url" },
      { table: "job_titles", column: "lottie_url" },
    ]);
  }

  revalidateTag("master-images", {});

  return NextResponse.json({
    community: {
      id: community.id,
      name: community.name,      image_url: community.image_url ?? null,
      lottie_url: null,
      lottie_format: null,
      lottie_data: null,
    },
    master_synced,
  });
}