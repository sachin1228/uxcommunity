import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

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
    .select("id, max_attendees")
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  // Check if already RSVPed
  const { data: existing } = await db
    .from("event_rsvps")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // Toggle off — remove RSVP
    await db.from("event_rsvps").delete().eq("event_id", eventId).eq("user_id", userId);
    const { data: remaining } = await db.from("event_rsvps").select("event_id").eq("event_id", eventId);
    return NextResponse.json({ rsvped: false, rsvp_count: (remaining ?? []).length });
  }

  // Check capacity
  if (event.max_attendees) {
    const { data: current } = await db.from("event_rsvps").select("event_id").eq("event_id", eventId);
    if ((current ?? []).length >= event.max_attendees) {
      return NextResponse.json({ error: "This event is full." }, { status: 409 });
    }
  }

  await db.from("event_rsvps").insert({ event_id: eventId, user_id: userId });
  const { data: all } = await db.from("event_rsvps").select("event_id").eq("event_id", eventId);
  return NextResponse.json({ rsvped: true, rsvp_count: (all ?? []).length });
}
