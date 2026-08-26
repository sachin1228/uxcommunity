import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

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

  // Verify resource exists
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

  const body = (await request.json().catch(() => null)) as { saved?: unknown } | null;
  if (typeof body?.saved !== "boolean") {
    return NextResponse.json({ error: "A boolean saved state is required." }, { status: 400 });
  }

  const mutation = body.saved
    ? await db.from("resource_saves").upsert(
        { resource_id: resourceId, user_id: userId },
        { onConflict: "resource_id,user_id", ignoreDuplicates: true },
      )
    : await db.from("resource_saves").delete().eq("resource_id", resourceId).eq("user_id", userId);
  if (mutation.error) return NextResponse.json({ error: "Failed to update resource save." }, { status: 500 });

  const [{ data: persisted, error: stateError }, { count, error: countError }] = await Promise.all([
    db.from("resource_saves").select("resource_id").eq("resource_id", resourceId).eq("user_id", userId).maybeSingle(),
    db.from("resource_saves").select("resource_id", { count: "exact", head: true }).eq("resource_id", resourceId),
  ]);
  if (stateError || countError || Boolean(persisted) !== body.saved) {
    return NextResponse.json({ error: "Resource save state could not be confirmed." }, { status: 500 });
  }

  void publishRealtimeBatch([
    { room: realtimeRooms.resources(communityId), topic: "save", data: { event: body.saved ? "INSERT" : "DELETE", resource_id: resourceId, user_id: userId } },
  ]);
  return NextResponse.json({ saved: body.saved, save_count: count ?? 0 });
}
