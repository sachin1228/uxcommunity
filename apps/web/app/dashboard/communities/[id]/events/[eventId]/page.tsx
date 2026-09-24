import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { EventDetailClient } from "@/components/communities/events/EventDetailClient";
import { enrichEventCards, loadEventRsvps, EVENT_CARD_COLUMNS } from "@/lib/communities/event-cards";
import { getEventChatCommunity, isEventChatMember } from "@/lib/communities/event-chat";

interface Props {
  params: Promise<{ id: string; eventId: string }>;
}

export default async function EventDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  // Verify membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) redirect(`/dashboard/communities/${communityId}`);

  const { data } = await db
    .from("community_events")
    .select(EVENT_CARD_COLUMNS)
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!data) redirect(`/dashboard/communities/${communityId}`);

  // Shared serializer + shared attendee loader: this page and the feed card
  // render the same payload, built in one place.
  const [[event], initialRsvps, communityData, userRow, profileRow] = await Promise.all([
    enrichEventCards([data as unknown as Record<string, unknown>], userId),
    loadEventRsvps(eventId),
    db.from("communities").select("name, image_url").eq("id", communityId).maybeSingle(),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  // The event's group chat, when it exists, is what the page's Join/Open
  // event chat row offers — the room is where everybody going talks about it.
  const chatCommunity = await getEventChatCommunity(db, eventId).catch(() => null);
  const chatCommunityJoined = chatCommunity
    ? await isEventChatMember(db, chatCommunity.id, userId)
    : false;

  return (
    <EventDetailClient
      event={event}
      initialRsvps={initialRsvps}
      currentUserId={userId}
      currentUserName={userRow.data?.name ?? ""}
      currentUserAvatar={profileRow.data?.avatar_url ?? null}
      communityId={communityId}
      communityName={communityData.data?.name ?? "Community"}
      chatCommunityId={chatCommunity?.id ?? null}
      chatCommunityImage={chatCommunity?.image_url ?? null}
      chatCommunityJoined={chatCommunityJoined}
      backHref={`/dashboard/communities/${communityId}?tab=events`}
      backLabel="Events"
    />
  );
}
