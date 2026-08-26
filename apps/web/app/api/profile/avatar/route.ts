import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { extensionForMime } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "A profile picture upload is required." },
      { status: 415 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "A profile picture is required." }, { status: 422 });
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG and WebP are accepted." }, { status: 422 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File exceeds 5 MB limit." }, { status: 413 });
  }

  const db = createServiceClient();
  const moderation = await validateAndModerateImage(file);
  await logModerationDecision(db, {
    userId: session.userId!,
    contentType: "image_upload",
    decision: moderation.decision,
  });
  if (!moderation.decision.allowed || !moderation.buffer) {
    return moderationFailureResponse(moderation.decision);
  }

  const storedMime = moderation.mime ?? file.type;
  const key = `avatars/${session.userId}/${Date.now()}.${extensionForMime(storedMime)}`;

  let publicUrl: string;
  try {
    publicUrl = await uploadToR2(key, moderation.buffer, storedMime);
  } catch (error) {
    console.error("[profile/avatar] R2 upload error:", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { error: dbError } = await db
    .from("designer_profiles")
    .update({ avatar_url: publicUrl, avatar_source: "upload" })
    .eq("user_id", session.userId!);

  if (dbError) {
    console.error("[profile/avatar] profile update error:", dbError);
    return NextResponse.json({ error: "Failed to save profile picture." }, { status: 500 });
  }

  return NextResponse.json({ avatar_url: publicUrl });
}
