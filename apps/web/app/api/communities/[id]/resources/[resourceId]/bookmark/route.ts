import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { createNotification, getActorName, resourceHref } from "@/lib/notifications";
import { isPublicContentScope } from "@/lib/content-scope";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  // Verify resource exists in this community
  let resourceQuery = db
    .from("community_resources")
    .select("id, user_id, title, is_public")
    .eq("id", resourceId);
  resourceQuery = publicScope
    ? resourceQuery.eq("is_public", true).is("community_id", null)
    : resourceQuery.eq("community_id", communityId);
  const { data: resource } = await resourceQuery.maybeSingle();
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });
  if (!resource.is_public && !publicScope) {
    const { data: membership } = await db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  // Toggle: delete if exists, insert if not
  const { data: existing } = await db
    .from("resource_bookmarks")
    .select("resource_id")
    .eq("resource_id", resourceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await db.from("resource_bookmarks").delete().eq("resource_id", resourceId).eq("user_id", userId);
  } else {
    await db.from("resource_bookmarks").insert({ resource_id: resourceId, user_id: userId });

    const actorName = await getActorName(db, userId);
    await createNotification(db, {
      userId: resource.user_id,
      actorId: userId,
      communityId,
      type: "resource_bookmark",
      entityType: "resource",
      entityId: resourceId,
      title: `${actorName} bookmarked your resource`,
      body: resource.title,
      href: resourceHref(communityId, resourceId),
    });
  }

  const { data: allBookmarks } = await db
    .from("resource_bookmarks")
    .select("resource_id")
    .eq("resource_id", resourceId);

  return NextResponse.json({
    bookmarked: !existing,
    bookmark_count: (allBookmarks ?? []).length,
  });
}
