import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { EventDetailClient } from "@/components/communities/events/EventDetailClient";
import type { CommunityEvent, EventRsvp } from "@/components/communities/events/types";

interface Props {
  params: Promise<{ id: string }>;
}

async function getPublicEvent(
  db: ReturnType<typeof createServiceClient>,
  eventId: string,
  userId: string,
): Promise<CommunityEvent | null> {
  const { data } = await db
    .from("community_events")
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, is_public, created_at, updated_at")
    .eq("id", eventId)
    .eq("is_public", true)
    .maybeSingle();

  if (!data) return null;

  const authorId = data.user_id;
  const [{ data: userRow }, { data: profileRow }, { data: allRsvps }, { data: myRsvp }] =
    await Promise.all([
      db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
      db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
      db.from("event_rsvps").select("event_id").eq("event_id", eventId),
      db.from("event_rsvps").select("event_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    ]);

  return {
    ...(data as unknown as CommunityEvent),
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    rsvp_count: (allRsvps ?? []).length,
    user_rsvped: Boolean(myRsvp),
  };
}

async function getRsvps(
  db: ReturnType<typeof createServiceClient>,
  eventId: string,
): Promise<EventRsvp[]> {
  const { data } = await db
    .from("event_rsvps")
    .select("event_id, user_id, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (!data?.length) return [];

  const userIds = data.map((r) => r.user_id);
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  return data.map((r) => ({
    ...r,
    users: nameMap[r.user_id] ? { name: nameMap[r.user_id], avatar_url: avatarMap[r.user_id] ?? null } : null,
  }));
}

export default async function PublicEventDetailPage({ params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id: eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const [event, initialRsvps] = await Promise.all([
    getPublicEvent(db, eventId, userId),
    getRsvps(db, eventId),
  ]);

  if (!event) redirect("/dashboard");

  const [communityData, userRow, profileRow] = await Promise.all([
    db.from("communities").select("name").eq("id", event.community_id).maybeSingle(),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
  ]);

  return (
    <EventDetailClient
      event={event}
      initialRsvps={initialRsvps}
      currentUserId={userId}
      currentUserName={userRow.data?.name ?? ""}
      currentUserAvatar={profileRow.data?.avatar_url ?? null}
      communityId={event.community_id}
      communityName={communityData.data?.name ?? "Community"}
    />
  );
}
