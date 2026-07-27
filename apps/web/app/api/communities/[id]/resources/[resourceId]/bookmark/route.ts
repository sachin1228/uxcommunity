import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  // Verify membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });

  // Verify resource exists in this community
  const { data: resource } = await db
    .from("community_resources")
    .select("id")
    .eq("id", resourceId)
    .eq("community_id", communityId)
    .maybeSingle();
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

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
