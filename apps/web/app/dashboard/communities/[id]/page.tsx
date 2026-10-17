import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchCommunityMetaSSR } from "@/lib/communities/server";
import { loadCommunityMessagePage } from "@/lib/communities/read-models";
import type { CachedMessage } from "@/lib/communities/cache";
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

  // Server snapshot in two parallel reads: the community read model the
  // header paints from, and the first message page the chat paints from.
  // Messages ride the RSC payload as `initialMessages`, so the chat no longer
  // waits on the client's /bootstrap fetch for its first paint — that fetch
  // (and the full bootstrap in particular) used to gate the first messages
  // behind seconds of sequential DB waves on a cold open. Secondary sections
  // (member details, tab collections, rules) still hydrate client-side from
  // the cached /bootstrap fetch. A message page that fails — or a non-member —
  // simply falls back to that same client-side path.
  const [ssrData, ssrMessagePage] = await Promise.all([
    fetchCommunityMetaSSR(id, userId).catch(() => null),
    loadCommunityMessagePage(id, userId).catch(() => null),
  ]);
  const initialMessages = ssrMessagePage?.ok
    ? (ssrMessagePage.data.messages as CachedMessage[])
    : undefined;

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
  // facts the Explore page shows — plus the viewer's join eligibility.
  // An unknown/inactive community falls through to the chat's own
  // "Community not found" state.
  //
  // A member is never sent here, even when the read model above failed to load:
  // the preview introduces a community they already belong to, and the chat
  // loads its own metadata client-side.
  if (!ssrData) {
    const preview = await loadCommunityPreview(createServiceClient(), id, userId).catch(() => null);
    if (preview && !preview.joined) {
      return (
        <CommunityPreview
          communityId={preview.id}
          name={preview.name}
          type={preview.type}
          isPrivate={preview.is_private}
          imageUrl={preview.image_url}
          description={preview.description}
          memberCount={preview.member_count}
          canJoin={preview.can_join}
          hasPendingRequest={preview.has_pending_request}
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
      initialMessages={initialMessages}
      initialLastReadAt={ssrData?.lastReadAt}
      initialTab={initialTab}
    />
  );
}
