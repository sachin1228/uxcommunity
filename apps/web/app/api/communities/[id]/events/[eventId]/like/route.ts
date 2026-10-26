import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { HOME_FEED_TAG } from "@/lib/home-feed-cache";
import { loadEventForViewer } from "@/lib/communities/event-access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  // Liking a post is one of the few writes a read-only account may make.
  try { session = await requireSession("user", { allowUnverified: true }); } catch (error) { return error as Response; }

  const body = (await request.json().catch(() => null)) as { liked?: unknown } | null;
  if (typeof body?.liked !== "boolean") {
    return NextResponse.json({ error: "A boolean liked state is required." }, { status: 400 });
  }

  const { id: communityId, eventId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const access = await loadEventForViewer<{ id: string; is_public: boolean }>(
    db,
    communityId,
    eventId,
    userId,
    "id, is_public",
  );
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? "Event not found." : "Not a member of this community." },
      { status: access.status },
    );
  }

  const mutation = body.liked
    ? await db.from("event_likes").upsert(
        { event_id: eventId, user_id: userId },
        { onConflict: "event_id,user_id", ignoreDuplicates: true },
      )
    : await db.from("event_likes").delete().eq("event_id", eventId).eq("user_id", userId);

  if (mutation.error) return NextResponse.json({ error: "Failed to update like." }, { status: 500 });

  void publishRealtimeBatch([
    {
      room: realtimeRooms.events(communityId),
      topic: "like",
      // The INSERT/DELETE marker lets clients patch the row; without it an
      // event id + user id cannot tell a like from an unlike.
      data: { event: body.liked ? "INSERT" : "DELETE", event_id: eventId, user_id: userId },
    },
  ]);

  const [{ data: persisted, error: stateError }, { count, error: countError }] = await Promise.all([
    db.from("event_likes").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    db.from("event_likes").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  if (stateError || countError || Boolean(persisted) !== body.liked) {
    return NextResponse.json({ error: "Like state could not be confirmed." }, { status: 500 });
  }

  // Drop the cached home feed so its user_liked snapshot doesn't predate this
  // mutation (otherwise the heart reverts to its pre-click state on refresh).
  revalidateTag(HOME_FEED_TAG, { expire: 0 });

  return NextResponse.json({ liked: body.liked, like_count: count ?? 0 });
}
