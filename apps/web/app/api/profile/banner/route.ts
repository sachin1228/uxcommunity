import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { detectImageMime, extensionForMime } from "@/lib/image-utils";
import { deleteFromR2, deleteR2AssetIfUnreferenced, uploadToR2 } from "@/lib/r2";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/** The profile hero's cover image — separate from the avatar upload. */
export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "A banner upload is required." }, { status: 415 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "A banner image is required." }, { status: 422 });
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG and WebP are accepted." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 5 MB limit." }, { status: 413 });
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = detectImageMime(buffer);
  if (!mime) {
    return NextResponse.json({ error: "That file is not a valid JPEG, PNG or WebP image." }, { status: 422 });
  }

  const { data: currentProfile, error: profileReadError } = await db
    .from("designer_profiles")
    .select("banner_url")
    .eq("user_id", userId)
    .single();

  if (profileReadError) {
    // 42703 = undefined_column — the banner migration has not been applied yet.
    if ((profileReadError as { code?: string }).code === "42703") {
      console.error("[profile/banner] banner_url column is missing; migration not applied.");
      return NextResponse.json(
        { error: "Banners are not enabled on this deployment yet. Please try again later." },
        { status: 503 },
      );
    }
    console.error("[profile/banner] profile read error:", profileReadError);
    return NextResponse.json({ error: "Failed to load the current banner." }, { status: 500 });
  }

  const storedMime = mime;
  const key = `banners/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionForMime(storedMime)}`;

  let publicUrl: string;
  try {
    publicUrl = await uploadToR2(key, buffer, storedMime);
  } catch (error) {
    console.error("[profile/banner] R2 upload error:", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data: updatedProfile, error: dbError } = await db
    .from("designer_profiles")
    // Untyped service client — same cast the admin media routes use.
    .update({ banner_url: publicUrl } as never)
    .eq("user_id", userId)
    .select("user_id")
    .single();

  if (dbError || !updatedProfile) {
    // The row still points at the previous banner, so this upload would be
    // orphaned the moment we abandon it — drop it instead of leaking it.
    try {
      await deleteFromR2(key);
    } catch (cleanupError) {
      console.error("[profile/banner] new upload cleanup error:", cleanupError);
    }
    console.error("[profile/banner] profile update error:", dbError);
    return NextResponse.json({ error: "Failed to save banner." }, { status: 500 });
  }

  // Reclaim the replaced banner. This runs AFTER the row was repointed, so the
  // reference scan must be "delete when nothing points at it" — the
  // delete-if-unique helper expects the row to still hold exactly one
  // reference and silently skips once the update has landed.
  const previousUrl = (currentProfile as { banner_url?: string | null } | null)?.banner_url ?? null;
  if (previousUrl) {
    await deleteR2AssetIfUnreferenced(db, previousUrl, [
      { table: "designer_profiles", column: "banner_url" },
    ]);
  }

  return NextResponse.json({ banner_url: publicUrl });
}

/** Remove the banner and fall back to the gradient. */
export async function DELETE() {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const { data: currentProfile } = await db
    .from("designer_profiles")
    .select("banner_url")
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await db
    .from("designer_profiles")
    .update({ banner_url: null } as never)
    .eq("user_id", userId);

  if (error) {
    // 42703 = undefined_column — the banner migration has not been applied yet.
    if ((error as { code?: string }).code === "42703") {
      return NextResponse.json(
        { error: "Banners are not enabled on this deployment yet." },
        { status: 503 },
      );
    }
    console.error("[profile/banner] clear error:", error);
    return NextResponse.json({ error: "Failed to remove banner." }, { status: 500 });
  }

  // Same reclaim rule as the replace path: the row no longer points at the
  // banner we just cleared, so delete it if nothing else does.
  const previousUrl = (currentProfile as { banner_url?: string | null } | null)?.banner_url ?? null;
  if (previousUrl) {
    await deleteR2AssetIfUnreferenced(db, previousUrl, [
      { table: "designer_profiles", column: "banner_url" },
    ]);
  }

  return NextResponse.json({ banner_url: null });
}
