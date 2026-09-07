import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { EventDetailClient } from "@/components/communities/events/EventDetailClient";
import { HomeSidebar } from "@/app/dashboard/HomeSidebar";
import type { CommunityEvent, EventRsvp } from "@/components/communities/events/types";

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const { data } = await db
    .from("community_events")
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, created_at, updated_at")
    .eq("id", eventId)
    .maybeSingle();

  if (!data) redirect("/dashboard");

  const communityId = data.community_id as string;
  const authorId = data.user_id;

  const [
    { data: membership },
    { data: userRow },
    { data: profileRow },
    { data: allRsvps },
    { data: myRsvp },
    { data: allLikes },
    { data: myLike },
    { data: allSaves },
    { data: mySave },
    { data: communityData },
  ] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("event_rsvps").select("event_id").eq("event_id", eventId),
    db.from("event_rsvps").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    db.from("event_likes").select("event_id").eq("event_id", eventId),
    db.from("event_likes").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    db.from("event_saves").select("event_id").eq("event_id", eventId),
    db.from("event_saves").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("name, image_url").eq("id", communityId).maybeSingle(),
  ]);

  if (!membership) redirect(`/dashboard/communities/${communityId}`);

  const event: CommunityEvent = {
    ...(data as unknown as CommunityEvent),
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    rsvp_count: (allRsvps ?? []).length,
    user_rsvped: Boolean(myRsvp),
    like_count: (allLikes ?? []).length,
    user_liked: Boolean(myLike),
    save_count: (allSaves ?? []).length,
    user_saved: Boolean(mySave),
  };

  const userIds = (allRsvps ?? []).map((r) => r.user_id);
  const [{ data: rsvpUsers }, { data: rsvpProfiles }] = userIds.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", userIds),
        db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
      ])
    : [{ data: [] }, { data: [] }];

  const nameMap = Object.fromEntries((rsvpUsers ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((rsvpProfiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  const initialRsvps: EventRsvp[] = (allRsvps ?? []).map((r) => ({
    ...r,
    users: nameMap[r.user_id] ? { name: nameMap[r.user_id], avatar_url: avatarMap[r.user_id] ?? null } : null,
  }));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
        <div className="mx-auto w-full max-w-[40rem]">
          <EventDetailClient
            event={event}
            initialRsvps={initialRsvps}
            currentUserId={userId}
            currentUserName={userRow?.name ?? ""}
            currentUserAvatar={profileRow?.avatar_url ?? null}
            communityId={communityId}
            communityName={communityData?.name ?? "Community"}
            communityImage={communityData?.image_url ?? null}
            showCommunityAttribution
            backHref="/dashboard"
            backLabel="Home"
          />
        </div>
        <HomeSidebar />
      </div>
    </div>
  );
}
