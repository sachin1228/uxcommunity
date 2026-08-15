import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { compressAvatar } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { loadCommunityReadModel } from "@/lib/communities/read-models";
import {
  getExperienceLevelNameMap,
  getMasterImageMap,
  getMasterNameMap,
  TABLE_LOOKUP,
} from "@/lib/master-data-cache";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const VALID_TABS = new Set(["chat", "threads", "events", "resources"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }
  const { id } = await params;
  const result = await loadCommunityReadModel(id, session.userId!);
  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}

// ── PATCH /api/communities/[id] ─────────────────────────────────────────────
// Update name, description, privacy, tabs, rules. Owner only.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id } = await params;
  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id, owner_id")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (community.owner_id !== userId) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  // Accept FormData (multipart, used when image may be included)
  let formData: FormData;
  try { formData = await req.formData(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const getString = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : null;
  };

  const updates: Record<string, unknown> = {};

  const name = getString("name");
  if (name !== null) {
    if (name.length < 1 || name.length > 80) return NextResponse.json({ error: "Name must be 1–80 characters." }, { status: 422 });
    updates.name = name;
  }

  const description = getString("description");
  if (description !== null) {
    if (description.length > 500) return NextResponse.json({ error: "Description must be 500 characters or less." }, { status: 422 });
    updates.description = description || null;
  }

  const isPrivateStr = getString("is_private");
  if (isPrivateStr !== null) {
    updates.is_private = isPrivateStr === "true";
  }

  const tabsStr = getString("tabs");
  if (tabsStr) {
    try {
      const parsed = JSON.parse(tabsStr);
      if (Array.isArray(parsed)) {
        updates.enabled_tabs = Array.from(new Set(["chat", ...(parsed as string[]).filter((t) => VALID_TABS.has(t))]));
      }
    } catch { /* ignore */ }
  }

  // Handle image upload / removal
  let imageUrlResult: string | null | undefined; // undefined = no change
  const file = formData.get("image");
  const removeImage = getString("remove_image") === "true";

  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG and WebP images are allowed." }, { status: 422 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Community picture must be under 10 MB." }, { status: 422 });
    }
    const moderation = await validateAndModerateImage(file);
    await logModerationDecision(db, { userId, contentType: "image_upload", decision: moderation.decision });
    if (!moderation.decision.allowed || !moderation.buffer) {
      return moderationFailureResponse(moderation.decision);
    }
    try {
      const compressed = await compressAvatar(moderation.buffer);
      const key = `communities/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${compressed.ext}`;
      imageUrlResult = await uploadToR2(key, compressed.data, compressed.contentType);
    } catch (err) {
      console.error("[community-settings] image upload failed:", err);
      return NextResponse.json({ error: "Community picture upload failed." }, { status: 500 });
    }
    updates.image_url = imageUrlResult;
  } else if (removeImage) {
    imageUrlResult = null;
    updates.image_url = null;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db.from("communities").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to update community." }, { status: 500 });
  }

  // Update rules if provided
  const rulesStr = getString("rules");
  if (rulesStr) {
    try {
      const parsed = JSON.parse(rulesStr);
      if (Array.isArray(parsed)) {
        const rules = (parsed as unknown[])
          .filter((r): r is string => typeof r === "string")
          .map((r) => r.trim())
          .filter(Boolean)
          .slice(0, 12);

        await db.from("community_rules").delete().eq("community_id", id);
        if (rules.length) {
          await db.from("community_rules").insert(
            rules.map((rule_text, order_index) => ({ community_id: id, rule_text, order_index }))
          );
        }
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({ success: true, ...(imageUrlResult !== undefined ? { image_url: imageUrlResult } : {}) });
}

// ── DELETE /api/communities/[id] ────────────────────────────────────────────
// Permanently delete the community. Owner only.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id } = await params;
  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id, owner_id")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (community.owner_id !== userId) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  // Soft-delete (mark inactive) to preserve chat history references.
  const { error } = await db
    .from("communities")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Failed to delete community." }, { status: 500 });
  return NextResponse.json({ success: true });
}
