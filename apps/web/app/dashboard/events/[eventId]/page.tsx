import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { EventDetailClient } from "@/components/communities/events/EventDetailClient";
import { HomeRail } from "@/app/dashboard/HomeRail";
import { enrichEventCards, loadEventRsvps, EVENT_CARD_COLUMNS } from "@/lib/communities/event-cards";
import { getEventChatCommunity, isEventChatMember } from "@/lib/communities/event-chat";

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const { data } = await db
    .from("community_events")
    .select(EVENT_CARD_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  if (!data) redirect("/dashboard");

  const communityId = data.community_id as string;

  // One serializer for every event surface: the card here is handed exactly the
  // row the feed hands it.
  const [event] = await enrichEventCards(
    [data as unknown as Record<string, unknown>],
    userId,
  );

  const [{ data: membership }, { data: communityData }, initialRsvps] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("name, image_url").eq("id", communityId).maybeSingle(),
    loadEventRsvps(eventId),
  ]);

  if (!membership) redirect(`/dashboard/communities/${communityId}`);

  // The event's group chat, when it exists — the page's Join/Open event chat
  // row hands off to it (see EventChatPanel).
  const chatCommunity = await getEventChatCommunity(db, eventId).catch(() => null);
  let chatCommunityJoined = false;
  let chatMemberCount = 0;
  if (chatCommunity) {
    const [joined, { count }] = await Promise.all([
      isEventChatMember(db, chatCommunity.id, userId),
      db
        .from("community_members")
        .select("community_id", { count: "exact", head: true })
        .eq("community_id", chatCommunity.id),
    ]);
    chatCommunityJoined = joined;
    chatMemberCount = count ?? 0;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[40rem]">
          <EventDetailClient
            event={event}
            initialRsvps={initialRsvps}
            currentUserId={userId}
            currentUserName={event.users?.name ?? ""}
            currentUserAvatar={event.users?.avatar_url ?? null}
            communityId={communityId}
            communityName={communityData?.name ?? "Community"}
            communityImage={communityData?.image_url ?? null}
            chatCommunityId={chatCommunity?.id ?? null}
            chatCommunityName={chatCommunity?.name ?? null}
            chatCommunityImage={chatCommunity?.image_url ?? null}
            chatMemberCount={chatMemberCount}
            chatCommunityJoined={chatCommunityJoined}
            showCommunityAttribution
            backHref="/dashboard"
            backLabel="Home"
          />
        </div>
        <HomeRail userId={userId} />
      </div>
    </div>
  );
}
