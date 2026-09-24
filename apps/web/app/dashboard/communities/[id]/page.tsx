import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchCommunityMetaSSR } from "@/lib/communities/server";
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
  if (!ssrData) {
    const db = createServiceClient();
    const [{ data: community }, { count: memberCount }] = await Promise.all([
      db
        .from("communities")
        .select("id, name, type, reference_id, image_url, description, is_private")
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle(),
      db.from("community_members").select("community_id", { count: "exact", head: true }).eq("community_id", id),
    ]);

    if (community) {
      // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
      const row = community as unknown as {
        id: string;
        name: string;
        type: string;
        reference_id: string | null;
        image_url: string | null;
        description: string | null;
        is_private: boolean | null;
      };

      // One count per public content area — the same rows the home feed
      // surfaces. Any query that fails simply hides its pill.
      const countRows = await Promise.all([
        db.from("community_threads").select("id", { count: "exact", head: true }).eq("community_id", id).eq("is_public", true),
        db.from("community_events").select("id", { count: "exact", head: true }).eq("community_id", id).eq("is_public", true),
        db.from("community_showcase_posts").select("id", { count: "exact", head: true }).eq("community_id", id).eq("is_public", true),
        db.from("community_resources").select("id", { count: "exact", head: true }).eq("community_id", id).eq("is_public", true),
      ]);

      // canJoin mirrors the Explore page's rule (get_all_communities): open to
      // interest/general/user types, profile-derived types need a profile
      // match, and private communities go through the request flow.
      const [{ data: profile }, { data: pendingRequest }] = await Promise.all([
        row.type === "interest" || row.type === "general" || row.type === "user" || row.is_private
          ? Promise.resolve({ data: null })
          : db.from("designer_profiles").select("city_id, sector_id, experience_level, job_title").eq("user_id", userId).maybeSingle(),
        db.from("community_join_requests").select("community_id").eq("community_id", id).eq("user_id", userId).eq("status", "pending").maybeSingle(),
      ]);

      let canJoin = false;
      if (row.type === "interest" || row.type === "general" || row.type === "user") {
        canJoin = true;
      } else if (profile) {
        const profileRow = profile as unknown as { city_id: string | null; sector_id: string | null; experience_level: string | null; job_title: string | null };
        if (row.type === "sector") canJoin = profileRow.sector_id === row.reference_id;
        else if (row.type === "city") canJoin = profileRow.city_id === row.reference_id;
        else if (row.type === "experience_level" && profileRow.experience_level) {
          const { data: expLevel } = await db.from("experience_levels").select("id").eq("slug", profileRow.experience_level).maybeSingle();
          canJoin = (expLevel as unknown as { id: string } | null)?.id === row.reference_id;
        } else if (row.type === "job_title" && profileRow.job_title) {
          const { data: jobTitle } = await db.from("job_titles").select("id").eq("slug", profileRow.job_title).maybeSingle();
          canJoin = (jobTitle as unknown as { id: string } | null)?.id === row.reference_id;
        }
      }

      return (
        <CommunityPreview
          communityId={row.id}
          name={row.name}
          type={row.type}
          isPrivate={row.is_private ?? false}
          imageUrl={row.image_url}
          description={row.description}
          memberCount={memberCount ?? 0}
          publicCounts={{
            ...(countRows[0].count ? { threads: countRows[0].count } : {}),
            ...(countRows[1].count ? { events: countRows[1].count } : {}),
            ...(countRows[2].count ? { showcase: countRows[2].count } : {}),
            ...(countRows[3].count ? { resources: countRows[3].count } : {}),
          }}
          canJoin={canJoin}
          hasPendingRequest={Boolean(pendingRequest)}
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
