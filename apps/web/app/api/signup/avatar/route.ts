import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { sendWelcomeEmail } from "@/lib/email";
import { extensionForMime } from "@/lib/image-utils";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";
import { rateLimit } from "@/lib/auth/rate-limit";
import { completeSignupSchema } from "@/lib/validations";
import { autoJoinCommunities } from "@/lib/communities/auto-join";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function safeSignupError(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    return { status: 409, message: "An account with this email already exists." };
  }
  if (error.message === "invitation_unavailable") {
    return { status: 409, message: "This invitation link is no longer available." };
  }
  if (error.code === "23503" || error.code === "22023") {
    return { status: 422, message: "One or more signup selections are no longer available." };
  }
  return { status: 500, message: "Failed to create account. Please try again." };
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rateLimitResult = await rateLimit(`signup:complete:${ip}`, 5, 3600);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  let rawPayload: unknown;
  let file: File | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const payload = formData.get("payload");
      const candidate = formData.get("file");
      if (typeof payload !== "string" || !(candidate instanceof File)) {
        return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
      }
      rawPayload = JSON.parse(payload);
      file = candidate;
    } else {
      rawPayload = await request.json();
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = completeSignupSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  if (file && parsed.data.avatar_source !== "upload") {
    return NextResponse.json({ error: "Invalid profile picture source." }, { status: 422 });
  }
  if (!file && parsed.data.avatar_source) {
    return NextResponse.json({ error: "A profile picture file is required." }, { status: 422 });
  }

  const { identity, profile, interest_ids, token } = parsed.data;
  const db = createServiceClient();
  const nameDecision = await moderateText({ content: identity.name, contentType: "username" });
  await logModerationDecision(db, {
    contentType: "username",
    contentHash: contentHash(identity.name),
    decision: nameDecision,
  });
  if (!nameDecision.allowed) return moderationFailureResponse(nameDecision);

  let profilePictureUrl: string | null = null;
  let uploadedKey: string | null = null;

  if (file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG, and WebP images are allowed." }, { status: 422 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 3 MB." }, { status: 422 });
    }

    const moderation = await validateAndModerateImage(file);
    await logModerationDecision(db, { contentType: "image_upload", decision: moderation.decision });
    if (!moderation.decision.allowed || !moderation.buffer) {
      return moderationFailureResponse(moderation.decision);
    }

    const storedMime = moderation.mime ?? file.type;
    uploadedKey = `avatars/pending/${randomUUID()}.${extensionForMime(storedMime)}`;
    try {
      profilePictureUrl = await uploadToR2(uploadedKey, moderation.buffer, storedMime);
    } catch (error) {
      console.error("[signup/avatar] R2 upload error:", error);
      return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    }
  }

  const passwordHash = await bcrypt.hash(identity.password, 12);
  const { data, error } = await db.rpc("complete_signup", {
    p_name: identity.name,
    p_email: identity.email.toLowerCase(),
    p_password_hash: passwordHash,
    p_city_id: profile.city_id,
    p_sector_id: profile.sector_id,
    p_experience_level: profile.experience_level,
    p_interest_ids: [...new Set(interest_ids)],
    p_avatar_url: profilePictureUrl,
    p_avatar_source: profilePictureUrl ? "upload" : null,
    p_invitation_token: token ?? null,
  });

  if (error || !data?.[0]?.user_id) {
    if (uploadedKey) {
      try {
        await deleteFromR2(uploadedKey);
      } catch (cleanupError) {
        console.error("[signup/avatar] R2 cleanup error:", cleanupError);
      }
    }
    console.error("[signup/avatar] atomic completion error:", error);
    const mapped = safeSignupError(error ?? {});
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  const userId = data[0].user_id as string;

  // Join every profile-based community (General + city + sector + interests)
  // server-side so the sidebar shows the full list the first time the dashboard
  // loads. Non-fatal if it fails — the dashboard layout retries exactly once via
  // the designer_profiles.communities_auto_joined flag.
  let joinedCommunities = 0;
  try {
    const joined = await autoJoinCommunities(userId);
    joinedCommunities = joined.length;
  } catch (autoJoinError) {
    console.error("[signup/avatar] auto-join error:", autoJoinError);
  }

  if (token) {
    try {
      await sendWelcomeEmail(identity.email.toLowerCase(), identity.name);
    } catch (emailError) {
      console.error("[signup/avatar] welcome email error:", emailError);
    }
  }

  const sessionToken = await createSession({
    userId,
    email: identity.email.toLowerCase(),
    role: "user",
  });
  const response = NextResponse.json({
    success: true,
    userId,
    avatar_url: profilePictureUrl,
    joined_communities: joinedCommunities,
  });
  setSessionCookie(response, sessionToken, request.nextUrl.hostname);
  return response;
}
