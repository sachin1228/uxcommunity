import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteFromR2, parseR2Key, shouldDeletePreviousR2Asset, uploadToR2 } from "@/lib/r2";
import { resolveCommunityDp } from "@/lib/communities/dp";

const MAX_IMAGE_BYTES  = 5 * 1024 * 1024; // 5 MB — same as master-data uploads
const MAX_LOTTIE_BYTES = 5 * 1024 * 1024; // 5 MB — .lottie containers can hold assets
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

const MASTER_TABLE: Record<string, { table: string; idCol: string }> = {
  city:             { table: "cities",            idCol: "id" },
  sector:           { table: "design_sectors",    idCol: "id" },
  interest:         { table: "design_interests",  idCol: "id" },
  experience_level: { table: "experience_levels", idCol: "id" },
};

// ── POST /api/admin/communities/[id]/dp ──────────────────────────────────────
// Replaces the display picture of an APP-CREATED community (owner_id IS NULL)
// with an uploaded image or a Lottie animation (.lottie / .json). The change
// is mirrored onto the linked master-data row, so it propagates everywhere the
// app resolves master images, and the master-image caches are flushed.
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
  if (community.owner_id) {
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
  if (kind !== "image" && kind !== "lottie") {
    return NextResponse.json({ error: "kind must be \"image\" or \"lottie\"." }, { status: 422 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  let communityUpdate: Record<string, string | null>;
  let masterUpdate: Record<string, string | null>;
  let uploadKey: string;
  let contentType: string;

  if (kind === "image") {
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
    communityUpdate = { image_url: null, lottie_url: null, lottie_format: null }; // set below
    masterUpdate = { image_url: null, lottie_url: null, lottie_format: null };
  } else {
    const name = file.name.toLowerCase();
    const isDotLottie = name.endsWith(".lottie");
    const isJson = name.endsWith(".json") || file.type === "application/json";
    if (!isDotLottie && !isJson) {
      return NextResponse.json(
        { error: "Only .lottie or .json Lottie animation files are allowed." },
        { status: 422 }
      );
    }
    if (file.size > MAX_LOTTIE_BYTES) {
      return NextResponse.json({ error: "Lottie file must be under 5 MB." }, { status: 422 });
    }
    if (isJson) {
      try { JSON.parse(await file.text()); } catch {
        return NextResponse.json({ error: "File is not valid Lottie JSON." }, { status: 422 });
      }
    } else {
      // .lottie files are ZIP containers — check the magic bytes.
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const magic = String.fromCharCode(...head);
      if (magic !== "PK\u0003\u0004" && magic !== "PK\u0005\u0006") {
        return NextResponse.json({ error: "File is not a valid .lottie animation." }, { status: 422 });
      }
    }
    const format = isDotLottie ? "dotlottie" : "json";
    const ext = isDotLottie ? "lottie" : "json";
    uploadKey = `communities/${id}/dp-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    contentType = isDotLottie ? "application/octet-stream" : "application/json";
    communityUpdate = { lottie_url: null, lottie_format: format };
    masterUpdate = { lottie_url: null, lottie_format: format };
  }

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
  } else {
    communityUpdate.lottie_url = url;
    masterUpdate.lottie_url = url;
  }

  const { error: communityError } = await db
    .from("communities")
    .update(communityUpdate)
    .eq("id", id);
  if (communityError) {
    console.error("[community-dp] community update failed:", communityError);
    return NextResponse.json({ error: "Failed to save display picture." }, { status: 500 });
  }

  const previousUrl = community.image_url ?? null;
  const nextUrl = kind === "image" ? url : community.image_url ?? null;
  if (shouldDeletePreviousR2Asset(previousUrl, nextUrl) && previousUrl) {
    const previousKey = parseR2Key(previousUrl);
    if (previousKey) {
      try {
        await deleteFromR2(previousKey);
      } catch (cleanupError) {
        console.error("[community-dp] previous picture cleanup failed:", cleanupError);
      }
    }
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

  revalidateTag("master-images", {});

  const dp = await resolveCommunityDp({
    type: community.type,
    reference_id: community.reference_id,
    image_url: communityUpdate.image_url ?? community.image_url ?? null,
    lottie_url: communityUpdate.lottie_url ?? community.lottie_url ?? null,
    lottie_format: communityUpdate.lottie_format ?? community.lottie_format ?? null,
    embedLottie: true,
  });

  return NextResponse.json({
    community: {
      id: community.id,
      name: community.name,
      image_url: dp.image_url,
      lottie_url: dp.lottie_url,
      lottie_format: dp.lottie_format,
      lottie_data: dp.lottie_data,
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
    .select("id, name, type, reference_id, owner_id, image_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (community.owner_id) {
    return NextResponse.json(
      { error: "Only app-created communities can change the display picture." },
      { status: 422 }
    );
  }

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

  revalidateTag("master-images", {});

  return NextResponse.json({
    community: {
      id: community.id,
      name: community.name,
      image_url: community.image_url ?? null,
      lottie_url: null,
      lottie_format: null,
      lottie_data: null,
    },
    master_synced,
  });
}