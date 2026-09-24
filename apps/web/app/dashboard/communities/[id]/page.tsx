import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchCommunityMetaSSR } from "@/lib/communities/server";
import { loadCommunityPreview } from "@/lib/communities/preview";
import { loadEventChatGate } from "@/lib/communities/event-chat";
import { CommunityChat } from "@/components/communities/CommunityChat";
import { CommunityPreview } from "@/components/communities/CommunityPreview";
import { EventChatJoinGate } from "@/components/communities/events/EventChatJoinGate";
import type { ChatTab } from "@/components/communities/chat/ChatHeader";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function CommunityPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab: ChatTab =
    tab === "showcase" || tab === "threads" || tab === "events" || tab === "resources" || tab === "members" ? tab : "chat";
  const userId = (session as { userId: string }).userId;

  // Lightweight server snapshot: community read model + top members only, so
  // the header and info panel paint immediately. Messages and tab sections
  // hydrate client-side (cached + realtime with the Lottie loader while the
  // first message page loads) — navigation never blocks on the full read model.
  const ssrData = await fetchCommunityMetaSSR(id, userId).catch(() => null);

  // An event's group chat is joined on confirmation — the read model and the
  // message routes both refuse non-members, so a non-member gets the event and
  // the confirm step here rather than an empty chat. Anyone who may not see the
  // event at all is sent to it, where that question belongs.
  if (!ssrData) {
    const gate = await loadEventChatGate(createServiceClient(), id, userId).catch(() => null);
    if (gate) {
      if (!gate.canJoin) {
        redirect(
          gate.event.community_id
            ? `/dashboard/communities/${gate.event.community_id}`
            : "/dashboard",
        );
      }
      return (
        <EventChatJoinGate
          communityId={id}
          communityName={gate.communityName}
          memberCount={gate.memberCount}
          rsvpCount={gate.rsvpCount}
          event={gate.event}
        />
      );
    }
  }

  // A non-member who follows a public home-feed card into its community gets a
  // read-only preview with a Join action, not "Community not found." The chat
  // itself stays members-only (the read model and message routes refuse
  // non-members), so this page only shows what is already public — the same
  // facts the Explore page shows — plus how much public content led here.
  // An unknown/inactive community falls through to the chat's own
  // "Community not found" state.
  if (!ssrData) {
    const preview = await loadCommunityPreview(createServiceClient(), id, userId).catch(() => null);
    if (preview) {
      return (
        <CommunityPreview
          communityId={preview.id}
          name={preview.name}
          type={preview.type}
          isPrivate={preview.is_private}
          imageUrl={preview.image_url}
          description={preview.description}
          memberCount={preview.member_count}
          publicCounts={preview.public_counts}
          canJoin={preview.can_join}
          hasPendingRequest={preview.has_pending_request}
          joined={preview.joined}
        />
      );
    }
  }

  return (
    <CommunityChat
      communityId={id}
      currentUserId={userId}
      currentUserName={ssrData?.currentUserName ?? "Someone"}
      initialMeta={ssrData?.meta}
      initialLastReadAt={ssrData?.lastReadAt}
      initialTab={initialTab}
    />
  );
}
