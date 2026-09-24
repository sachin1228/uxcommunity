import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deferNotification, eventHref } from "@/lib/notifications";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { HOME_FEED_TAG } from "@/lib/home-feed-cache";
import {
  canJoinEventChat,
  ensureEventChatCommunity,
  getEventChatCommunity,
  joinEventChat,
  leaveEventChat,
} from "@/lib/communities/event-chat";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let eventQuery = db
    .from("community_events")
    .select("id, user_id, title, cover_image_url, is_public, community_id, max_attendees")
    .eq("id", eventId);
  eventQuery = publicScope
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);
  const { data: event } = await eventQuery.maybeSingle();

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
    const { error: deleteError } = await db
      .from("event_rsvps")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", userId);
    if (deleteError) {
      return NextResponse.json({ error: "Failed to update RSVP. Please try again." }, { status: 500 });
    }
    revalidateTag(HOME_FEED_TAG, { expire: 0 });

    // Not going any more means leaving the event's group chat with the RSVP:
    // the room is for the people going. The creator keeps their own group.
    let leftChatCommunityId: string | null = null;
    try {
      const chat = await getEventChatCommunity(db, eventId);
      if (chat) {
        leftChatCommunityId = chat.id;
        await leaveEventChat(db, chat.id, userId);
      }
    } catch (error) {
      console.error("[event RSVP] group chat leave failed:", error);
    }

    void publishRealtimeBatch([
      { room: realtimeRooms.events(communityId), topic: "rsvp", data: { event: "DELETE", event_id: eventId, user_id: userId } },
    ]);
    const { data: remaining } = await db.from("event_rsvps").select("event_id").eq("event_id", eventId);
    return NextResponse.json({
      rsvped: false,
      rsvp_count: (remaining ?? []).length,
      // The client drops this room from the sidebar (the member just left it).
      chat_community_id: leftChatCommunityId,
    });
  }

  // Check capacity
  if (event.max_attendees) {
    const { data: current } = await db.from("event_rsvps").select("event_id").eq("event_id", eventId);
    if ((current ?? []).length >= event.max_attendees) {
      return NextResponse.json({ error: "This event is full." }, { status: 409 });
    }
  }

  // Surface insert failures: a silent failure here made the client show
  // "Going ✓" while nothing was persisted, so the state reverted on refresh.
  const { error: insertError } = await db
    .from("event_rsvps")
    .insert({ event_id: eventId, user_id: userId });
  if (insertError) {
    return NextResponse.json({ error: "Failed to RSVP. Please try again." }, { status: 500 });
  }

  // Confirming "I'm going" is also the door into the event's group chat: the
  // room is created on demand here (covering events that predate the group)
  // and the attendee is put in it, so the event's chat shows up in their
  // sidebar and everybody going can talk about it in one place. Membership
  // still follows the event's own visibility rule, so an RSVP can never be a
  // way into a room its event does not open.
  let chatCommunityId: string | null = null;
  try {
    if (await canJoinEventChat(db, event, userId)) {
      chatCommunityId = await ensureEventChatCommunity(
        db,
        {
          id: eventId,
          title: event.title,
          coverImageUrl: (event as { cover_image_url?: string | null }).cover_image_url ?? null,
        },
        event.user_id,
      );
      if (chatCommunityId) await joinEventChat(db, chatCommunityId, userId);
    }
  } catch (error) {
    console.error("[event RSVP] group chat join failed:", error);
  }

  // Drop the cached home feed so it no longer serves the pre-RSVP snapshot
  // (user_rsvped: false / stale rsvp_count) right after a successful RSVP.
  revalidateTag(HOME_FEED_TAG, { expire: 0 });

  void publishRealtimeBatch([
    { room: realtimeRooms.events(communityId), topic: "rsvp", data: { event: "INSERT", event_id: eventId, user_id: userId } },
  ]);
  deferNotification({
    userId: event.user_id,
    actorId: userId,
    communityId,
    type: "event_rsvp",
    entityType: "event",
    entityId: eventId,
    title: (actorName) => `${actorName} RSVPed to your event`,
    body: event.title,
    href: eventHref(communityId, eventId),
  });

  const { data: all } = await db.from("event_rsvps").select("event_id").eq("event_id", eventId);
  return NextResponse.json({
    rsvped: true,
    rsvp_count: (all ?? []).length,
    chat_community_id: chatCommunityId,
  });
}
