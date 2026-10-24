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
  try { session = await requireSession("user"); } catch (error) { return error as Response; }

  const body = (await request.json().catch(() => null)) as { saved?: unknown } | null;
  if (typeof body?.saved !== "boolean") {
    return NextResponse.json({ error: "A boolean saved state is required." }, { status: 400 });
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

  const mutation = body.saved
    ? await db.from("event_saves").upsert(
        { event_id: eventId, user_id: userId },
        { onConflict: "event_id,user_id", ignoreDuplicates: true },
      )
    : await db.from("event_saves").delete().eq("event_id", eventId).eq("user_id", userId);

  if (mutation.error) return NextResponse.json({ error: "Failed to update save." }, { status: 500 });

  void publishRealtimeBatch([
    {
      room: realtimeRooms.events(communityId),
      topic: "save",
      // Same contract as the like route: clients patch from the marker instead
      // of refetching both event pages to learn which way the count moved.
      data: { event: body.saved ? "INSERT" : "DELETE", event_id: eventId, user_id: userId },
    },
  ]);

  const [{ data: persisted, error: stateError }, { count, error: countError }] = await Promise.all([
    db.from("event_saves").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    db.from("event_saves").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  if (stateError || countError || Boolean(persisted) !== body.saved) {
    return NextResponse.json({ error: "Save state could not be confirmed." }, { status: 500 });
  }

  // Drop the cached home feed so its user_saved snapshot doesn't predate this
  // mutation (otherwise the bookmark reverts to its pre-click state on refresh).
  revalidateTag(HOME_FEED_TAG, { expire: 0 });

  return NextResponse.json({ saved: body.saved, save_count: count ?? 0 });
}
