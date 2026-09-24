import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";
import { canJoinEventChatWith, eventChatName } from "./event-chat-rules";

/**
 * The event group chat is an ordinary community of `type = 'event'` whose
 * `event_id` points at the event it belongs to (see the
 * event-chat-communities migration). Everything downstream — chat, realtime,
 * sidebar unread counts, message push — works off the community id it already
 * understands, so this module is only responsible for linking the two.
 */

type Db = ReturnType<typeof createServiceClient>;

const EVENT_CHAT_DESCRIPTION =
  "Group chat for this event — say hi to everyone going.";

export interface EventChatLink {
  id: string;
  name: string;
  image_url: string | null;
  owner_id: string | null;
}

/** The group chat community linked to an event, or null when none exists yet. */
export async function getEventChatCommunity(
  db: Db,
  eventId: string,
): Promise<EventChatLink | null> {
  const { data } = await db
    .from("communities")
    .select("id, name, image_url, owner_id")
    .eq("event_id", eventId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as EventChatLink | null) ?? null;
}

/**
 * Find-or-create the group chat for an event and make its creator a member.
 *
 * Idempotent: the partial unique index on communities.event_id is the referee,
 * so a concurrent create loses the race and re-reads instead of failing the
 * request. The creator joins as owner — they are in the room from the moment
 * the event exists — while everybody else joins by confirming they are going
 * (the RSVP route, or the event page's Join event chat).
 */
export async function ensureEventChatCommunity(
  db: Db,
  event: { id: string; title: string; coverImageUrl: string | null },
  creatorId: string,
): Promise<string | null> {
  const existing = await getEventChatCommunity(db, event.id);
  if (existing) return existing.id;

  const { data: community, error } = await db
    .from("communities")
    .insert({
      name: eventChatName(event.title),
      description: EVENT_CHAT_DESCRIPTION,
      type: "event",
      reference_id: null,
      image_url: event.coverImageUrl,
      owner_id: creatorId,
      is_private: false,
      event_id: event.id,
      // A group chat: the event itself is the content, so no other areas.
      enabled_tabs: ["chat"],
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !community) {
    // Another request may have created it between the read and the write.
    const raced = await getEventChatCommunity(db, event.id);
    if (raced) return raced.id;
    throw new Error(
      `[event-chat] group insert failed for event ${event.id}: ${error?.message ?? "no row returned"}`,
    );
  }

  const id = (community as { id: string }).id;
  const { error: memberError } = await db
    .from("community_members")
    .upsert(
      { community_id: id, user_id: creatorId, role: "owner" },
      { onConflict: "community_id,user_id", ignoreDuplicates: true },
    );
  if (memberError) {
    console.error("[event-chat] creator membership failed:", memberError);
  }

  return id;
}

/**
 * Keep an existing group chat in step with its event: the room is named after
 * the event and wears the same cover, so a rename or a new cover must not leave
 * a stale room (or a room pointing at a deleted image) behind.
 */
export async function syncEventChatCommunity(
  db: Db,
  event: { id: string; title: string; coverImageUrl: string | null },
  creatorId: string,
): Promise<string | null> {
  const id = await ensureEventChatCommunity(db, event, creatorId);
  if (!id) return null;

  const { error } = await db
    .from("communities")
    .update({
      name: eventChatName(event.title),
      image_url: event.coverImageUrl,
    })
    .eq("event_id", event.id);
  if (error) console.error("[event-chat] group sync failed:", error);
  return id;
}

/** Whether this member is already in the event's group chat. */
export async function isEventChatMember(
  db: Db,
  communityId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await db
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Put a member in an event's group chat. Used when somebody confirms they are
 * going (the RSVP route) or confirms joining from the group's own page.
 */
export async function joinEventChat(
  db: Db,
  communityId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await db
    .from("community_members")
    .upsert(
      { community_id: communityId, user_id: userId },
      { onConflict: "community_id,user_id", ignoreDuplicates: true },
    );
  return !error;
}

/**
 * Remove a member from an event's group chat — nobody stays in a room for an
 * event they are no longer going to. The owner is never removed: their group
 * would lose the only person who can manage it, and they can re-RSVP.
 */
export async function leaveEventChat(
  db: Db,
  communityId: string,
  userId: string,
): Promise<void> {
  const { data: community } = await db
    .from("communities")
    .select("owner_id")
    .eq("id", communityId)
    .maybeSingle();
  if ((community as { owner_id: string | null } | null)?.owner_id === userId) return;

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);
  if (error) console.error("[event-chat] membership removal failed:", error);
}

/** Columns the gate/panel need to describe the event behind a group chat. */
export interface EventChatEvent {
  id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  cover_image_url: string | null;
  is_online: boolean;
  location: string | null;
  is_public: boolean;
  community_id: string | null;
}

export async function loadEventChatEvent(
  db: Db,
  eventId: string,
): Promise<EventChatEvent | null> {
  const { data } = await db
    .from("community_events")
    .select("id, title, event_date, end_date, cover_image_url, is_online, location, is_public, community_id")
    .eq("id", eventId)
    .maybeSingle();
  return (data as EventChatEvent | null) ?? null;
}

/**
 * Whether this member may join the event's group chat: it is open to everyone
 * who can see the event — its own community's members, and everybody when the
 * event is public. Takes just the two facts the rule needs so any caller that
 * already selected them (the RSVP route, the gate) can ask the same question.
 */
export async function canJoinEventChat(
  db: Db,
  event: Pick<EventChatEvent, "is_public" | "community_id">,
  userId: string,
): Promise<boolean> {
  // The rule itself is unit tested; this only supplies the two facts it needs.
  if (event.is_public) return canJoinEventChatWith(true, false);
  if (!event.community_id) return canJoinEventChatWith(false, false);

  const { data } = await db
    .from("community_members")
    .select("community_id")
    .eq("community_id", event.community_id)
    .eq("user_id", userId)
    .maybeSingle();

  return canJoinEventChatWith(false, Boolean(data));
}

/**
 * Everything the confirm-to-join gate renders: the event, how many people are
 * already in the room, how many are going, and whether this member may join at
 * all. Returns null only when the community is not an event group (or its
 * event is gone), so the caller keeps its normal rendering path.
 */
export async function loadEventChatGate(
  db: Db,
  communityId: string,
  userId: string,
): Promise<EventChatGate | null> {
  const { data: community } = await db
    .from("communities")
    .select("id, name, event_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();
  const row = community as { id: string; name: string; event_id: string | null } | null;
  if (!row?.event_id) return null;

  const event = await loadEventChatEvent(db, row.event_id);
  if (!event) return null;

  const [canJoin, { count: memberCount }, { count: rsvpCount }] = await Promise.all([
    canJoinEventChat(db, event, userId),
    db.from("community_members").select("community_id", { count: "exact", head: true }).eq("community_id", communityId),
    db.from("event_rsvps").select("event_id", { count: "exact", head: true }).eq("event_id", event.id),
  ]);

  return {
    communityName: row.name,
    memberCount: memberCount ?? 0,
    rsvpCount: rsvpCount ?? 0,
    canJoin,
    event,
  };
}

export interface EventChatGate {
  communityName: string;
  memberCount: number;
  rsvpCount: number;
  /** False when the member cannot see the event at all — send them to it. */
  canJoin: boolean;
  event: EventChatEvent;
}
