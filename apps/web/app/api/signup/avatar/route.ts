import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { sendWelcomeEmail } from "@/lib/email";

const BUCKET = "profile-avatars";
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB (client compresses first, so this is a safety cap)
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_SOURCES = ["dicebear", "boring-avatars", "robohash", "avataaars", "multiavatar", "upload"] as const;

// M-4: allowlist of trusted avatar provider domains — reject any other URL
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
    // boring:// is a custom internal protocol used by the boring-avatars npm package.
    // These are rendered client-side as inline SVG — there is no external fetch.
    if (parsed.protocol === "boring:") return true;
    return ALLOWED_AVATAR_DOMAINS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Mark the invitation as used (only on first completion) and send a welcome
 * email. Using `is("used_at", null)` in the update ensures idempotency —
 * the email is only sent when used_at transitions from null to a value.
 */
async function finaliseSignup(userId: string): Promise<void> {
  const db = createServiceClient();

  // Fetch user for application_id + name/email
  const { data: user } = await db
    .from("users")
    .select("application_id, name, email")
    .eq("id", userId)
    .maybeSingle();

  if (!user?.application_id) return;

  // Atomic: only update if used_at is still null (first-time completion guard)
  const { data: updated } = await db
    .from("invitations")
    .update({ used_at: new Date().toISOString() })
    .eq("application_id", user.application_id)
    .is("used_at", null)
    .select("id");

  // Send welcome email only when we were the ones to set used_at
  if (updated && updated.length > 0) {
    try {
      await sendWelcomeEmail(user.email, user.name);
    } catch (emailErr) {
      console.error("[signup/avatar] welcome email error:", emailErr);
    }
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
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and WebP images are allowed." },
        { status: 422 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 3 MB." }, { status: 422 });
    }

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const storagePath = `${session.userId}/${Date.now()}.${ext}`;
    const db = createServiceClient();

    const { data, error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[signup/avatar] storage upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = db.storage.from(BUCKET).getPublicUrl(data.path);

    const { error: dbError } = await db
      .from("designer_profiles")
      .update({ avatar_url: publicUrl, avatar_source: "upload" })
      .eq("user_id", session.userId!);

    if (dbError) {
      console.error("[signup/avatar] profile update error:", dbError);
      return NextResponse.json({ error: "Failed to save avatar." }, { status: 500 });
    }

    // All 3 steps done — mark invitation used (idempotent) and send welcome email
    await finaliseSignup(session.userId!);

    return NextResponse.json({ avatar_url: publicUrl });
  }

  // ── Avatar URL selection path (DiceBear / Boring Avatars / Robohash) ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { avatar_url, avatar_source } = body as {
    avatar_url?: string;
    avatar_source?: string;
  };

  if (!avatar_url || typeof avatar_url !== "string") {
    return NextResponse.json({ error: "avatar_url is required." }, { status: 422 });
  }
  if (!avatar_source || !ALLOWED_SOURCES.includes(avatar_source as never)) {
    return NextResponse.json({ error: "Invalid avatar_source." }, { status: 422 });
  }
  // M-4: reject URLs not from an approved provider domain (SSRF / phishing prevention)
  if (!isAllowedAvatarUrl(avatar_url)) {
    return NextResponse.json({ error: "Avatar URL domain is not permitted." }, { status: 422 });
  }

  const db = createServiceClient();
  const { error: dbError } = await db
    .from("designer_profiles")
    .update({ avatar_url, avatar_source })
    .eq("user_id", session.userId!);

  if (dbError) {
    console.error("[signup/avatar] profile update error:", dbError);
    return NextResponse.json({ error: "Failed to save avatar." }, { status: 500 });
  }

  // All 3 steps done — mark invitation used (idempotent) and send welcome email
  await finaliseSignup(session.userId!);

  return NextResponse.json({ avatar_url });
}
