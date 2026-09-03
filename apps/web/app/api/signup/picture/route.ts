import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extensionForMime } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { rateLimit } from "@/lib/auth/rate-limit";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/signup/picture
 *
 * First real step of the welcome signup sequence when a profile picture was
 * chosen: moderate the image and upload it to R2. The returned avatar_url is
 * then passed to /api/signup/avatar (which only accepts URLs that live on our
 * own R2 bucket) when the account is created.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(`signup:picture:${ip}`, 10, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A profile picture file is required." }, { status: 422 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, and WebP images are allowed." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be under 3 MB." }, { status: 422 });
  }

  const db = createServiceClient();
  const moderation = await validateAndModerateImage(file);
  await logModerationDecision(db, { contentType: "image_upload", decision: moderation.decision });
  if (!moderation.decision.allowed || !moderation.buffer) {
    return moderationFailureResponse(moderation.decision);
  }

  const storedMime = moderation.mime ?? file.type;
  const key = `avatars/pending/${randomUUID()}.${extensionForMime(storedMime)}`;
  try {
    const avatarUrl = await uploadToR2(key, moderation.buffer, storedMime);
    return NextResponse.json({ success: true, avatar_url: avatarUrl });
  } catch (error) {
    console.error("[signup/picture] R2 upload error:", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
