import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import type { ResourceType } from "@/components/communities/resources/types";

const RESOURCE_TYPES = new Set<ResourceType>([
  "figma", "article", "tool", "video", "book",
  "font", "icon_pack", "color", "template", "inspiration", "other",
]);

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const tags = value.filter((t): t is string => typeof t === "string").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
  if (tags.length !== value.length || tags.some((t) => t.length > 30)) return null;
  return [...new Set(tags)].slice(0, 3);
}

async function enrichResource(
  db: ReturnType<typeof createServiceClient>,
  row: Record<string, unknown>,
  currentUserId: string,
) {
  const resourceId = row.id as string;
  const authorId = row.user_id as string;

  const [
    { data: userRow },
    { data: profileRow },
    { data: allSaves },
    { data: mySave },
    { count: commentCount },
    { data: allBookmarks },
    { data: myBookmark },
  ] = await Promise.all([
    db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("resource_saves").select("resource_id").eq("resource_id", resourceId),
    db.from("resource_saves").select("resource_id").eq("resource_id", resourceId).eq("user_id", currentUserId).maybeSingle(),
    db.from("resource_comments").select("id", { count: "exact", head: true }).eq("resource_id", resourceId),
    db.from("resource_bookmarks").select("resource_id").eq("resource_id", resourceId),
    db.from("resource_bookmarks").select("resource_id").eq("resource_id", resourceId).eq("user_id", currentUserId).maybeSingle(),
  ]);

  return {
    ...row,
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    save_count:      (allSaves ?? []).length,
    user_saved:      Boolean(mySave),
    comment_count:   commentCount ?? 0,
    bookmark_count:  (allBookmarks ?? []).length,
    user_bookmarked: Boolean(myBookmark),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data, error } = await db
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, tags, is_public, created_at, updated_at")
    .eq("id", resourceId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (error) { console.error("[GET resource]", error); return NextResponse.json({ error: "Failed to fetch resource." }, { status: 500 }); }
  if (!data) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  // Non-members may view public resources; private resources require membership
  if (!data.is_public) {
    const { data: membership } = await db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  return NextResponse.json({ resource: await enrichResource(db, data as Record<string, unknown>, userId) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data: existing } = await db.from("community_resources").select("id, user_id, community_id").eq("id", resourceId).eq("community_id", communityId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only edit your own resources." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const resourceType = body.resource_type as ResourceType;
  const tags = normalizeTags(body.tags);
  const isPublic = body.is_public === true;

  if (!title || title.length > 120) return NextResponse.json({ error: "Title is required and must be 120 characters or fewer." }, { status: 422 });
  if (!url || url.length > 2048) return NextResponse.json({ error: "URL is required." }, { status: 422 });
  try { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); }
  catch { return NextResponse.json({ error: "URL must start with http:// or https://" }, { status: 422 }); }
  if (!RESOURCE_TYPES.has(resourceType) || !tags) return NextResponse.json({ error: "One or more fields are invalid." }, { status: 422 });
  if (description && description.length > 2000) return NextResponse.json({ error: "Description must be 2000 characters or fewer." }, { status: 422 });

  const { data: updated, error } = await db
    .from("community_resources")
    .update({ title, description, resource_type: resourceType, url, tags, is_public: isPublic })
    .eq("id", resourceId)
    .select("id, community_id, user_id, title, description, resource_type, url, tags, is_public, created_at, updated_at")
    .single();

  if (error || !updated) { console.error("[PATCH resource]", error); return NextResponse.json({ error: "Failed to update resource." }, { status: 500 }); }

  return NextResponse.json({ resource: await enrichResource(db, updated as Record<string, unknown>, userId) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const { data: existing } = await db.from("community_resources").select("id, user_id, community_id").eq("id", resourceId).eq("community_id", communityId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "You can only delete your own resources." }, { status: 403 });

  const { error } = await db.from("community_resources").delete().eq("id", resourceId);
  if (error) { console.error("[DELETE resource]", error); return NextResponse.json({ error: "Failed to delete resource." }, { status: 500 }); }

  return new NextResponse(null, { status: 204 });
}
