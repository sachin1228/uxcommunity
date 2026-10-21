import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import type { CommunityEvent, EventChatCardLink, EventRsvp } from "@/lib/communities/models/events";
import { enrichCommunityEvents } from "./read-models";

/**
 * The one column list every event surface selects before handing a row to
 * `EventCard`. Kept here, next to the enrichment, so a query can't quietly drop
 * a field the card renders (`accent_color`, `is_public`, …) — the event page and
 * the feed disagreed on the accent colour for exactly that reason.
 *
 * Everything the card needs beyond these columns (author, counts, attendee
 * faces) is filled in by `enrichEventCards`.
 */
export const EVENT_CARD_COLUMNS =
  "id, community_id, user_id, title, description, event_date, end_date, is_online, is_public, location, meet_link, max_attendees, cover_image_url, accent_color, host_timezone, host_utc_offset_minutes, created_at, updated_at";

/** How many attendee faces the card's avatar stack shows. */
const ATTENDEE_PREVIEW_LIMIT = 5;

/**
 * `get_event_list_page` and the feed RPCs hand back the aggregate fields (and
 * often the author) already resolved; a raw `.select()` does not. A key that is
 * explicitly present — even as `null` — is treated as resolved, so an RPC row
 * keeps its own counts and the serializer only queries for what is missing.
 */
function carriesField(rows: Array<Record<string, unknown>>, key: string): boolean {
  return rows.every((row) => row[key] !== undefined);
}

/**
 * The card's attendee strip: a bounded slice of real RSVP profiles per event,
 * ordered oldest-first. Total attendee counts come from the aggregate RPCs.
 */
export async function loadEventAttendeePreviews(
  eventIds: string[],
  limit: number = ATTENDEE_PREVIEW_LIMIT,
): Promise<Map<string, EventRsvp[]>> {
  const ids = [...new Set(eventIds)];
  if (!ids.length) return new Map();
  const { data, error } = await callPerformanceRpc(createServiceClient(), "get_event_attendee_previews", {
    p_event_ids: ids,
    p_limit: limit,
  });
  if (error) throw new Error("Failed to load event attendees.");
  return new Map(
    (data ?? []).map((preview) => [preview.id, (preview.rsvps ?? []) as unknown as EventRsvp[]]),
  );
}

/**
 * The event's full attendee list, oldest RSVP first — loaded by the detail
 * pages for the card's avatar strip (feed surfaces use the limited
 * `loadEventAttendeePreviews` instead).
 */
export async function loadEventRsvps(eventId: string): Promise<EventRsvp[]> {
  const db = createServiceClient();
  // Casts match the repo-wide untyped supabase-js baseline (see next.config.js).
  const { data } = await db
    .from("event_rsvps")
    .select("event_id, user_id, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });
  const rsvps = (data ?? []) as Array<{ event_id: string; user_id: string; created_at: string }>;
  if (!rsvps.length) return [];

  const userIds = rsvps.map((rsvp) => rsvp.user_id);
  const [{ data: users }, { data: profiles }] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
  ]);
  const userRows = (users ?? []) as Array<{ id: string; name: string }>;
  const profileRows = (profiles ?? []) as Array<{ user_id: string; avatar_url: string | null }>;
  const nameMap = Object.fromEntries(userRows.map((user) => [user.id, user.name]));
  const avatarMap = Object.fromEntries(profileRows.map((profile) => [profile.user_id, profile.avatar_url]));

  return rsvps.map((rsvp) => ({
    ...rsvp,
    users: nameMap[rsvp.user_id]
      ? { name: nameMap[rsvp.user_id], avatar_url: avatarMap[rsvp.user_id] ?? null }
      : null,
  }));
}

async function loadEventCommentCounts(eventIds: string[]): Promise<Map<string, number>> {
  const { data, error } = await createServiceClient()
    .from("event_comments")
    .select("event_id")
    .in("event_id", eventIds);
  if (error) throw new Error("Failed to load event comment counts.");
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ event_id: string }>) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The room behind each of these events — when one exists — for the cards that
 * draw the Join/Open chat row (see EventChatPanel): id, name, picture, size,
 * and whether the viewer is already in it. Two batched reads for the whole
 * page: the rooms, then the viewer's memberships. An event without a room is
 * simply absent from the map.
 */
export async function loadEventChatCardLinks(
  eventIds: string[],
  viewerId: string,
): Promise<Map<string, EventChatCardLink>> {
  const links = new Map<string, EventChatCardLink>();
  const ids = [...new Set(eventIds)];
  if (!ids.length) return links;

  const db = createServiceClient();
  const { data: rooms, error } = await db
    .from("communities")
    .select("id, event_id, name, image_url, member_count")
    .in("event_id", ids)
    .eq("is_active", true);
  if (error) return links;
  const roomRows = (rooms ?? []) as Array<{
    id: string;
    event_id: string | null;
    name: string;
    image_url: string | null;
    member_count: number;
  }>;
  if (!roomRows.length) return links;

  const { data: memberships } = await db
    .from("community_members")
    .select("community_id")
    .eq("user_id", viewerId)
    .in("community_id", roomRows.map((room) => room.id));
  const joinedRoomIds = new Set(
    ((memberships ?? []) as Array<{ community_id: string }>).map((m) => m.community_id),
  );

  for (const room of roomRows) {
    if (!room.event_id) continue;
    links.set(room.event_id, {
      id: room.id,
      name: room.name,
      image_url: room.image_url,
      member_count: room.member_count,
      joined: joinedRoomIds.has(room.id),
    });
  }
  return links;
}

/**
 * Complete an event row into the shape `EventCard` renders. Every event surface
 * goes through here, so no page can hand the card a partially-loaded row again:
 *
 * - author (`users`) and like / RSVP / save counts come from
 *   `enrichCommunityEvents` (the shared read-model enrichment) whenever the
 *   caller selected raw columns, and are left untouched when the row already
 *   carries them (the list and feed RPCs resolve the same fields in SQL);
 * - `comment_count` is filled in whenever the row doesn't carry it — the event
 *   aggregate RPC has no comment count, which is why the community feed showed
 *   0 comments while the detail page showed the real number;
 * - `rsvps` previews are attached unless the caller passes `withRsvps: false`
 *   because it already loaded the full attendee list (the detail pages reuse
 *   that list for the avatar strip);
 * - `chat_member_count` and `chat_community` come from the event's group room
 *   when one exists — the RSVP confirm dialog shows the former on the room's
 *   row, and the cards draw their Join/Open chat row (see EventChatPanel) from
 *   the latter; no room yet leaves both null.
 */
export async function enrichEventCards(
  rows: Array<Record<string, unknown>>,
  currentUserId: string,
  { withRsvps = true }: { withRsvps?: boolean } = {},
): Promise<CommunityEvent[]> {
  if (!rows.length) return [];

  const enriched = carriesField(rows, "rsvp_count")
    ? rows
    : (await enrichCommunityEvents(rows, currentUserId)) as Array<Record<string, unknown>>;

  const ids = enriched.flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
  const needsCommentCount = !carriesField(enriched, "comment_count");
  const needsRsvps = withRsvps && !carriesField(enriched, "rsvps");

  const [commentCounts, previews, chatLinks] = await Promise.all([
    needsCommentCount && ids.length ? loadEventCommentCounts(ids) : null,
    needsRsvps && ids.length ? loadEventAttendeePreviews(ids) : null,
    ids.length ? loadEventChatCardLinks(ids, currentUserId) : null,
  ]);

  return enriched.map((row) => {
    const chat = chatLinks?.get(row.id as string) ?? null;
    return {
      ...row,
      ...(commentCounts ? { comment_count: commentCounts.get(row.id as string) ?? 0 } : {}),
      ...(previews ? { rsvps: previews.get(row.id as string) ?? [] } : {}),
      ...(chatLinks
        ? {
            chat_member_count: chat?.member_count ?? null,
            chat_community: chat,
          }
        : {}),
    };
  }) as unknown as CommunityEvent[];
}
