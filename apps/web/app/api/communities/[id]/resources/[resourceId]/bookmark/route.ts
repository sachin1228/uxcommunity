import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";

export async function POST(
  request: NextRequest,
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

  const body = (await request.json().catch(() => null)) as { bookmarked?: unknown } | null;
  if (typeof body?.bookmarked !== "boolean") {
    return NextResponse.json({ error: "A boolean bookmarked state is required." }, { status: 400 });
  }

  const mutation = body.bookmarked
    ? await db.from("resource_bookmarks").upsert(
        { resource_id: resourceId, user_id: userId },
        { onConflict: "resource_id,user_id", ignoreDuplicates: true },
      )
    : await db.from("resource_bookmarks").delete().eq("resource_id", resourceId).eq("user_id", userId);
  if (mutation.error) return NextResponse.json({ error: "Failed to update resource bookmark." }, { status: 500 });

  const [{ data: persisted, error: stateError }, { count, error: countError }] = await Promise.all([
    db.from("resource_bookmarks").select("resource_id").eq("resource_id", resourceId).eq("user_id", userId).maybeSingle(),
    db.from("resource_bookmarks").select("resource_id", { count: "exact", head: true }).eq("resource_id", resourceId),
  ]);
  if (stateError || countError || Boolean(persisted) !== body.bookmarked) {
    return NextResponse.json({ error: "Resource bookmark state could not be confirmed." }, { status: 500 });
  }

  return NextResponse.json({ bookmarked: body.bookmarked, bookmark_count: count ?? 0 });
}
