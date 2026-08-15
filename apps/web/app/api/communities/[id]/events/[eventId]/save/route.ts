import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { createServiceClient } from "@/lib/supabase/service";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

async function findEvent(db: ReturnType<typeof createServiceClient>, communityId: string, eventId: string) {
  let query = db.from("community_events").select("id").eq("id", eventId);
  query = isPublicContentScope(communityId)
    ? query.eq("is_public", true).is("community_id", null)
    : query.eq("community_id", communityId);
  const { data, error } = await query.maybeSingle();
  return { event: data, error };
}

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
  const lookup = await findEvent(db, communityId, eventId);
  if (lookup.error) return NextResponse.json({ error: "Failed to update save." }, { status: 500 });
  if (!lookup.event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const mutation = body.saved
    ? await db.from("event_saves").upsert(
        { event_id: eventId, user_id: userId },
        { onConflict: "event_id,user_id", ignoreDuplicates: true },
      )
    : await db.from("event_saves").delete().eq("event_id", eventId).eq("user_id", userId);

  if (mutation.error) return NextResponse.json({ error: "Failed to update save." }, { status: 500 });

  void publishRealtimeBatch([
    { room: realtimeRooms.events(communityId), topic: "save", data: { event_id: eventId, user_id: userId } },
  ]);

  const [{ data: persisted, error: stateError }, { count, error: countError }] = await Promise.all([
    db.from("event_saves").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    db.from("event_saves").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  if (stateError || countError || Boolean(persisted) !== body.saved) {
    return NextResponse.json({ error: "Save state could not be confirmed." }, { status: 500 });
  }

  return NextResponse.json({ saved: body.saved, save_count: count ?? 0 });
}
