/**
 * POST /api/profile/avatar
 *
 * Updates the current user's avatar. Accepts either:
 *   - JSON { avatar_url, avatar_source } — pre-generated URL (DiceBear etc.)
 *   - FormData { file }                 — uploaded JPEG / PNG / WebP
 *
 * Same logic as /api/signup/avatar but WITHOUT calling finaliseSignup.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { compressAvatar } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";

const ALLOWED_SOURCES = [
  "dicebear",
  "boring-avatars",
  "robohash",
  "avataaars",
  "multiavatar",
  "upload",
] as const;

const ALLOWED_AVATAR_DOMAINS = [
  "api.dicebear.com",
  "avataaars.io",
  "robohash.org",
  "source.boringavatars.com",
  "api.multiavatar.com",
];

function isAllowedAvatarUrl(url: string): boolean {
  if (url.startsWith("boring://")) return true;
  try {
    const { hostname } = new URL(url);
    return ALLOWED_AVATAR_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const contentType = request.headers.get("content-type") ?? "";

  // ── File upload path ────────────────────────────────────────
  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required." }, { status: 422 });
    }

    const mimeType = file.type;
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return NextResponse.json({ error: "Only JPEG, PNG and WebP are accepted." }, { status: 422 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 5 MB limit." }, { status: 413 });
    }

    // Compress to WebP (max 400×400, quality 85) before storing — reduces
    // storage size ~70-85% and cuts egress every time the avatar is served.
    const db = createServiceClient();
    const moderation = await validateAndModerateImage(file);
    await logModerationDecision(db, {
      userId: session.userId!,
      contentType: "image_upload",
      decision: moderation.decision,
    });
    if (!moderation.decision.allowed || !moderation.buffer) return moderationFailureResponse(moderation.decision);

    const compressed = await compressAvatar(moderation.buffer);
    const key = `avatars/${session.userId}/${Date.now()}.${compressed.ext}`;

    let publicUrl: string;
    try {
      publicUrl = await uploadToR2(key, compressed.data, compressed.contentType);
    } catch (err) {
      console.error("[profile/avatar] R2 upload error:", err);
      return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    }

    const { error: dbError } = await db
      .from("designer_profiles")
      .update({ avatar_url: publicUrl, avatar_source: "upload" })
      .eq("user_id", session.userId!);

    if (dbError) {
      console.error("[profile/avatar] profile update error:", dbError);
      return NextResponse.json({ error: "Failed to save avatar." }, { status: 500 });
    }

    return NextResponse.json({ avatar_url: publicUrl });
  }

  // ── Avatar URL selection path ──────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { avatar_url, avatar_source } = body as { avatar_url?: string; avatar_source?: string };

  if (!avatar_url || typeof avatar_url !== "string") {
    return NextResponse.json({ error: "avatar_url is required." }, { status: 422 });
  }
  if (!avatar_source || !ALLOWED_SOURCES.includes(avatar_source as never)) {
    return NextResponse.json({ error: "Invalid avatar_source." }, { status: 422 });
  }
  if (!isAllowedAvatarUrl(avatar_url)) {
    return NextResponse.json({ error: "Avatar URL domain is not permitted." }, { status: 422 });
  }

  const db = createServiceClient();
  const { error: dbError } = await db
    .from("designer_profiles")
    .update({ avatar_url, avatar_source })
    .eq("user_id", session.userId!);

  if (dbError) {
    console.error("[profile/avatar] profile update error:", dbError);
    return NextResponse.json({ error: "Failed to save avatar." }, { status: 500 });
  }

  return NextResponse.json({ avatar_url });
}
