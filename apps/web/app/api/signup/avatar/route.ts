import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { sendWelcomeEmail } from "@/lib/email";
import { compressAvatar } from "@/lib/image-utils";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";
import { rateLimit } from "@/lib/auth/rate-limit";
import { completeSignupSchema } from "@/lib/validations";

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_AVATAR_DOMAINS = new Set([
  "api.dicebear.com",
  "source.boringavatars.com",
  "robohash.org",
  "api.avataaars.io",
  "api.multiavatar.com",
]);

function isAllowedAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "boring:") return true;
    return parsed.protocol === "https:" && ALLOWED_AVATAR_DOMAINS.has(parsed.hostname);
  } catch {
    return false;
  }
}

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
  const rl = await rateLimit(`signup:complete:${ip}`, 5, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
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

  const { identity, profile, interest_ids, token, avatar_source } = parsed.data;
  const db = createServiceClient();
  const nameDecision = await moderateText({ content: identity.name, contentType: "username" });
  await logModerationDecision(db, {
    contentType: "username",
    contentHash: contentHash(identity.name),
    decision: nameDecision,
  });
  if (!nameDecision.allowed) return moderationFailureResponse(nameDecision);

  let avatarUrl = parsed.data.avatar_url;
  let uploadedKey: string | null = null;

  if (file) {
    if (avatar_source !== "upload") {
      return NextResponse.json({ error: "Invalid avatar source." }, { status: 422 });
    }
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

    const compressed = await compressAvatar(moderation.buffer);
    uploadedKey = `avatars/pending/${randomUUID()}.${compressed.ext}`;
    try {
      avatarUrl = await uploadToR2(uploadedKey, compressed.data, compressed.contentType);
    } catch (error) {
      console.error("[signup/avatar] R2 upload error:", error);
      return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    }
  } else if (!avatarUrl || avatar_source === "upload" || !isAllowedAvatarUrl(avatarUrl)) {
    return NextResponse.json({ error: "Avatar URL domain is not permitted." }, { status: 422 });
  }

  const passwordHash = await bcrypt.hash(identity.password, 12);
  const { data, error } = await db.rpc("complete_signup", {
    p_name: identity.name,
    p_email: identity.email.toLowerCase(),
    p_password_hash: passwordHash,
    p_company_id: profile.company_id,
    p_city_id: profile.city_id,
    p_sector_id: profile.sector_id,
    p_experience_level: profile.experience_level,
    p_interest_ids: [...new Set(interest_ids)],
    p_avatar_url: avatarUrl,
    p_avatar_source: avatar_source,
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
  const response = NextResponse.json({ success: true, userId, avatar_url: avatarUrl });
  setSessionCookie(response, sessionToken);
  return response;
}
