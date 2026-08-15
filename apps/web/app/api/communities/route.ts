import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { compressAvatar } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { getSidebarCommunities } from "@/lib/communities/sidebar-server";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const VALID_TABS = new Set(["chat", "threads", "events", "resources"]);

function parseString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "community";
}

export async function GET() {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }
  return getSidebarCommunities(session.userId!);
}

export async function POST(request: Request) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const db = createServiceClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const name = parseString(formData.get("name"));
  const description = parseString(formData.get("description"));
  const isPrivate = parseString(formData.get("privacy")) === "private";
  const tabs = Array.from(new Set(["chat", ...parseJsonArray(formData.get("tabs"))]))
    .filter((tab) => VALID_TABS.has(tab));
  const rules = parseJsonArray(formData.get("rules"))
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: "Community name must be 1-80 characters." }, { status: 422 });
  }
  if (description.length > 500) {
    return NextResponse.json({ error: "Description must be 500 characters or less." }, { status: 422 });
  }

  let imageUrl: string | null = null;
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG and WebP images are allowed." }, { status: 422 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Community picture must be under 10 MB." }, { status: 422 });
    }

    const moderation = await validateAndModerateImage(file);
    await logModerationDecision(db, {
      userId,
      contentType: "image_upload",
      decision: moderation.decision,
    });
    if (!moderation.decision.allowed || !moderation.buffer) {
      return moderationFailureResponse(moderation.decision);
    }

    try {
      const compressed = await compressAvatar(moderation.buffer);
      const key = `communities/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${compressed.ext}`;
      imageUrl = await uploadToR2(key, compressed.data, compressed.contentType);
    } catch (err) {
      console.error("[community-create] image upload failed:", err);
      return NextResponse.json({ error: "Community picture upload failed." }, { status: 500 });
    }
  }

  const inviteToken = randomUUID().replace(/-/g, "");
  const { data: community, error: communityError } = await db
    .from("communities")
    .insert({
      name,
      description: description || null,
      type: "user",
      reference_id: null,
      image_url: imageUrl,
      owner_id: userId,
      is_private: isPrivate,
      invite_token: inviteToken,
      enabled_tabs: tabs,
      is_active: true,
    })
    .select("id, name, type, image_url, is_private, invite_token, enabled_tabs")
    .single();

  if (communityError || !community) {
    console.error("[community-create] insert failed:", communityError);
    return NextResponse.json({ error: "Failed to create community." }, { status: 500 });
  }

  const { error: memberError } = await db
    .from("community_members")
    .insert({
      community_id: community.id,
      user_id: userId,
      role: "owner",
    });

  if (memberError) {
    await db.from("communities").delete().eq("id", community.id);
    console.error("[community-create] owner membership failed:", memberError);
    return NextResponse.json({ error: "Failed to create community membership." }, { status: 500 });
  }

  const rulesToInsert = rules.length
    ? rules
    : [
        "Be respectful and kind to all members.",
        "Keep discussions relevant to this community.",
        "No spam or unsolicited promotion.",
      ];

  await db.from("community_rules").insert(
    rulesToInsert.map((rule, index) => ({
      community_id: community.id,
      rule_text: rule,
      order_index: index,
    }))
  );

  const slug = slugify(name);
  const host = request.headers.get("host") ?? "uxcommunity.in";
  const protocol = host.includes("localhost") ? "http" : "https";

  return NextResponse.json({
    community: {
      ...community,
      member_count: 1,
      invite_url: `${protocol}://${host}/join/${slug}-${inviteToken}`,
    },
  }, { status: 201 });
}
