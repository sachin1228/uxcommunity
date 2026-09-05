import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus, logCommunityActivity } from "@/lib/communities/manager-role";
import { extensionForMime } from "@/lib/image-utils";
import { deleteOwnedR2AssetIfUnique, shouldDeletePreviousR2Asset, uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { loadCommunityReadModel } from "@/lib/communities/read-models";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
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
// Update name, description, privacy, tabs, rules.
// Allowed for the owner, and for platform-appointed community admins who hold
// the "edit community settings" permission (privacy is owner-only).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id } = await params;
  const db = createServiceClient();

  const managerStatus = await loadCommunityManagerStatus(db, id, userId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (!managerStatus.canManage) {
    return NextResponse.json({ error: "Owner or community admin only." }, { status: 403 });
  }
  if (managerStatus.role === "admin" && !managerStatus.permissions.can_edit_settings) {
    return NextResponse.json(
      { error: "You don't have permission to edit community settings." },
      { status: 403 },
    );
  }
  const isOwner = managerStatus.isOwner;

  // Snapshot the current values so the activity trail records what changed.
  const { data: before } = await db
    .from("communities")
    .select("name, description, image_url, is_private, enabled_tabs")
    .eq("id", id)
    .maybeSingle();

  // Accept FormData (multipart, used when image may be included)
  let formData: FormData;
  try { formData = await req.formData(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const getString = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : null;
  };

  const changed: string[] = [];
  const updates: Record<string, unknown> = {};

  const name = getString("name");
  if (name !== null) {
    if (name.length < 1 || name.length > 80) return NextResponse.json({ error: "Name must be 1–80 characters." }, { status: 422 });
    updates.name = name;
    if (name !== before?.name) changed.push("name");
  }

  const description = getString("description");
  if (description !== null) {
    if (description.length > 500) return NextResponse.json({ error: "Description must be 500 characters or less." }, { status: 422 });
    updates.description = description || null;
    if ((description || null) !== (before?.description ?? null)) changed.push("description");
  }

  const isPrivateStr = getString("is_private");
  // Privacy can only be toggled by the owner.
  if (isPrivateStr !== null && isOwner) {
    updates.is_private = isPrivateStr === "true";
    if (updates.is_private !== before?.is_private) changed.push("privacy");
  }

  const tabsStr = getString("tabs");
  if (tabsStr) {
    try {
      const parsed = JSON.parse(tabsStr);
      if (Array.isArray(parsed)) {
        const tabs = Array.from(new Set(["chat", ...(parsed as string[]).filter((t) => VALID_TABS.has(t))]));
        const sameTabs =
          (before?.enabled_tabs ?? []).slice().sort().join(",") === tabs.slice().sort().join(",");
        updates.enabled_tabs = tabs;
        if (!sameTabs) changed.push("tabs");
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
      const storedMime = moderation.mime ?? file.type;
      const key = `communities/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionForMime(storedMime)}`;
      imageUrlResult = await uploadToR2(key, moderation.buffer, storedMime);
    } catch (err) {
      console.error("[community-settings] image upload failed:", err);
      return NextResponse.json({ error: "Community picture upload failed." }, { status: 500 });
    }
    updates.image_url = imageUrlResult;
    if (imageUrlResult !== before?.image_url) changed.push("photo");
  } else if (removeImage) {
    imageUrlResult = null;
    updates.image_url = null;
    if (before?.image_url) changed.push("photo");
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db.from("communities").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: "Failed to update community." }, { status: 500 });

    const previousUrl = before?.image_url ?? null;
    const nextUrl = updates.image_url ?? before?.image_url ?? null;
    if (shouldDeletePreviousR2Asset(previousUrl, nextUrl) && previousUrl) {
      await deleteOwnedR2AssetIfUnique(db, previousUrl, [
        { table: "communities", column: "image_url" },
        { table: "cities", column: "image_url" },
        { table: "design_sectors", column: "image_url" },
        { table: "design_interests", column: "image_url" },
        { table: "experience_levels", column: "image_url" },
      ]);
    }
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

        const { data: previousRules } = (await db
          .from("community_rules")
          .select("id, community_id, rule_text, order_index")
          .eq("community_id", id)
          .order("order_index", { ascending: true })) as unknown as {
          data: Array<{ id: string; community_id: string; rule_text: string; order_index: number }> | null;
        };

        const prevText = (previousRules ?? []).map((rule) => rule.rule_text);
        if (prevText.join("\n") !== rules.join("\n")) changed.push("rules");

        await db.from("community_rules").delete().eq("community_id", id);
        if (rules.length) {
          await db.from("community_rules").insert(
            rules.map((rule_text, order_index) => ({ community_id: id, rule_text, order_index }))
          );
        }

        const { data: newRules } = (await db
          .from("community_rules")
          .select("id, community_id, rule_text, order_index")
          .eq("community_id", id)
          .order("order_index", { ascending: true })) as unknown as {
          data: Array<{ id: string; community_id: string; rule_text: string; order_index: number }> | null;
        };

        void publishRealtimeBatch([
          ...(previousRules ?? []).map((rule) => ({
            room: realtimeRooms.rules(id),
            topic: "rule",
            data: { event: "DELETE", rule },
          })),
          ...(newRules ?? []).map((rule) => ({
            room: realtimeRooms.rules(id),
            topic: "rule",
            data: { event: "INSERT", rule },
          })),
        ]);
      }
    } catch { /* ignore */ }
  }

  // Audit trail — snapshot the actor name so the trail survives renames.
  if (changed.length > 0) {
    const { data: actor } = await db.from("users").select("name").eq("id", userId).maybeSingle();
    await logCommunityActivity(db, {
      communityId: id,
      actorId: userId,
      actorRole: isOwner ? "owner" : "admin",
      actorName: actor?.name ?? null,
      action: "community_settings_updated",
      details: { changed },
    });
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
