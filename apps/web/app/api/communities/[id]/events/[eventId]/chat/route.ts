import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import {
  canJoinEventChat,
  ensureEventChatCommunity,
  joinEventChat,
} from "@/lib/communities/event-chat";
import { hasEventEnded } from "@/lib/communities/event-date";
import { joinAnswersPayload } from "@/lib/communities/event-join-questions";
import { storeEventJoinResponse } from "@/lib/communities/event-join-responses";

/**
 * POST /api/communities/[id]/events/[eventId]/chat
 *
 * The door into an event's group chat when the room does not exist yet — the
 * event page shows its Join row for any event that has not ended, and an event
 * whose group was never created (a creation that failed, or a room since
 * removed) must not leave everybody going with no way in.
 *
 * The join is the moment the room comes into being: find-or-create exactly as
 * the RSVP route does, with the event's creator as its owner, then the member
 * is put in it. Joining is never silent — the caller has already confirmed and
 * answered the host's compulsory questions, which are required here just as
 * they are in /api/communities/[id]/join.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  const body = (await req.json().catch(() => null)) as
    | { answers?: Record<string, unknown> }
    | null;
  const answers = joinAnswersPayload(body?.answers ?? {});
  if (!answers) {
    return NextResponse.json(
      { error: "Please answer all the host's questions to join." },
      { status: 400 },
    );
  }

  // Same scope addressing as the RSVP route: a community's event is looked up
  // under that community, the public scope under is_public.
  let eventQuery = db
    .from("community_events")
    .select("id, user_id, title, cover_image_url, is_public, community_id, event_date, end_date")
    .eq("id", eventId);
  eventQuery = publicScope
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);
  const { data } = await eventQuery.maybeSingle();

  const event = data as {
    id: string;
    user_id: string;
    title: string;
    cover_image_url: string | null;
    is_public: boolean;
    community_id: string | null;
    event_date: string;
    end_date: string | null;
  } | null;

  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  // The page stops offering the row once the event is over; this is the
  // server-side backstop for a request that raced the end of the window.
  if (hasEventEnded(event.event_date, event.end_date)) {
    return NextResponse.json({ error: "This event has ended." }, { status: 400 });
  }

  if (!(await canJoinEventChat(db, event, userId))) {
    return NextResponse.json(
      { error: "Only members of this event's community can join its chat." },
      { status: 403 },
    );
  }

  let chatCommunityId: string;
  try {
    const roomId = await ensureEventChatCommunity(
      db,
      { id: event.id, title: event.title, coverImageUrl: event.cover_image_url },
      event.user_id,
    );
    if (!roomId) throw new Error("no room id returned");
    chatCommunityId = roomId;
  } catch (error) {
    console.error("[event chat join] group creation failed:", error);
    return NextResponse.json({ error: "Failed to join the event chat." }, { status: 500 });
  }

  if (!(await joinEventChat(db, chatCommunityId, userId))) {
    return NextResponse.json({ error: "Failed to join the event chat." }, { status: 500 });
  }

  // Best-effort by design (see storeEventJoinResponse) — a logging failure
  // must not flip a successful join into an error the member would retry.
  await storeEventJoinResponse(db, chatCommunityId, userId, answers);

  return NextResponse.json({ chat_community_id: chatCommunityId });
}
