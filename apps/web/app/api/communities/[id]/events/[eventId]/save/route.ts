import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { createNotification, eventHref, getActorName } from "@/lib/notifications";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  // Verify event belongs to community
  const { data: event } = await db
    .from("community_events")
    .select("id, user_id, title")
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  // Toggle
  const { data: existing } = await db
    .from("event_saves")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await db.from("event_saves").delete().eq("event_id", eventId).eq("user_id", userId);
  } else {
    await db.from("event_saves").insert({ event_id: eventId, user_id: userId });

    const actorName = await getActorName(db, userId);
    await createNotification(db, {
      userId: event.user_id,
      actorId: userId,
      communityId,
      type: "event_save",
      entityType: "event",
      entityId: eventId,
      title: `${actorName} saved your event`,
      body: event.title,
      href: eventHref(communityId, eventId),
    });
  }

  const { data: all } = await db
    .from("event_saves")
    .select("event_id")
    .eq("event_id", eventId);

  return NextResponse.json({
    saved: !existing,
    save_count: (all ?? []).length,
  });
}
