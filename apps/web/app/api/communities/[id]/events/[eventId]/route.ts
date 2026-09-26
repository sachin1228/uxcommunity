import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { deleteR2AssetIfUnreferenced, deleteOwnedR2AssetIfUnique, shouldDeletePreviousR2Asset } from "@/lib/r2";
import { enrichEventCards, EVENT_CARD_COLUMNS } from "@/lib/communities/event-cards";
import { syncEventChatCommunity } from "@/lib/communities/event-chat";
import { requireZoneAwareIso } from "@/lib/communities/event-time";
import type { Database } from "@/lib/supabase/database.types";

/**
 * An IANA zone name the runtime can resolve, or null — the same best-effort
 * rule the create route applies, since this is display metadata.
 */
function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** The host's offset in minutes east of UTC, or null when it isn't a sane one. */
function validOffsetMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.abs(value) <= 840 ? value : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let eventQuery = db
    .from("community_events")
    .select(EVENT_CARD_COLUMNS)
    .eq("id", eventId);
  eventQuery = publicScope
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);
  const { data, error } = await eventQuery.maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const [enriched] = await enrichEventCards([data as unknown as Record<string, unknown>], userId);
  return NextResponse.json({ event: enriched });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let existingQuery = db
    .from("community_events")
    // cover_image_url is fetched so replaced/removed covers can be cleaned up
    // from R2 after the update; event_date is fetched so a move can be told
    // from an untouched schedule (see the host-zone note below).
    .select("id, user_id, cover_image_url, event_date")
    .eq("id", eventId);
  existingQuery = publicScope
    ? existingQuery.eq("is_public", true).is("community_id", null)
    : existingQuery.eq("community_id", communityId);
  const { data: existing } = await existingQuery.maybeSingle();

  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "Not the event owner." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  const patch: Database["public"]["Tables"]["community_events"]["Update"] = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title || title.length > 120) return NextResponse.json({ error: "Title is required (max 120 characters)." }, { status: 422 });
    patch.title = title;
  }
  if ("description" in body) {
    patch.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    if (patch.description && (patch.description as string).length > 5000) return NextResponse.json({ error: "Description too long." }, { status: 422 });
  }
  // A timestamp with no zone would be read in the database session's zone
  // (UTC), landing hours from what the member typed — so one is required. The
  // event form sends the viewer's own offset explicitly (see event-time.ts).
  if (typeof body.event_date === "string") {
    const ed = requireZoneAwareIso(body.event_date);
    if (!ed) return NextResponse.json({ error: "Invalid event date." }, { status: 422 });
    patch.event_date = ed;
    // The host's zone belongs to the moment the schedule was set, so it is only
    // rewritten when the schedule itself moved. A host who edits a description
    // from another country must not silently relabel the time they chose, and
    // an untouched start hands back the same instant — see startMovedByEdit.
    const stored = (existing as unknown as { event_date?: string | null }).event_date ?? null;
    const moved = !stored || Math.abs(Date.parse(ed) - Date.parse(stored)) >= 60_000;
    if (moved) {
      if ("host_timezone" in body) patch.host_timezone = validTimeZone(body.host_timezone);
      if ("host_utc_offset_minutes" in body) {
        patch.host_utc_offset_minutes = validOffsetMinutes(body.host_utc_offset_minutes);
      }
    }
  }
  if ("end_date" in body) {
    const raw = typeof body.end_date === "string" && body.end_date ? body.end_date : null;
    const ed = raw ? requireZoneAwareIso(raw) : null;
    if (raw && !ed) return NextResponse.json({ error: "Invalid end date." }, { status: 422 });
    patch.end_date = ed;
  }
  if (typeof body.is_online === "boolean") patch.is_online = body.is_online;
  if ("location" in body) patch.location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : null;
  if ("meet_link" in body) {
    const ml = typeof body.meet_link === "string" && body.meet_link.trim() ? body.meet_link.trim() : null;
    if (ml) {
      try { const u = new URL(ml); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); }
      catch { return NextResponse.json({ error: "Meet link must be a valid URL." }, { status: 422 }); }
    }
    patch.meet_link = ml;
  }
  if ("max_attendees" in body) {
    patch.max_attendees = typeof body.max_attendees === "number" && body.max_attendees > 0
      ? Math.floor(body.max_attendees)
      : null;
  }
  if ("cover_image_url" in body) {
    patch.cover_image_url = typeof body.cover_image_url === "string" && body.cover_image_url.trim()
      ? body.cover_image_url.trim()
      : null;
  }
  if ("accent_color" in body) {
    patch.accent_color = typeof body.accent_color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent_color.trim())
      ? body.accent_color.trim().toLowerCase()
      : null;
  }
  if (typeof body.is_public === "boolean") patch.is_public = body.is_public;

  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 422 });

  const { data, error } = await db
    .from("community_events")
    .update(patch)
    .eq("id", eventId)
    .select(EVENT_CARD_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the event's group chat in step with the event it belongs to: the room
  // is named after the event and wears the same cover, so it has to follow a
  // rename or a new cover. Runs before the R2 cleanup below so the group never
  // points at an image the cleanup is about to delete.
  const updatedRow = data as unknown as { title: string; cover_image_url: string | null };
  let chatCommunityId: string | null = null;
  try {
    chatCommunityId = await syncEventChatCommunity(
      db,
      {
        id: eventId,
        title: updatedRow.title,
        coverImageUrl: updatedRow.cover_image_url ?? null,
      },
      (existing as unknown as { user_id: string }).user_id,
    );
  } catch (chatError) {
    console.error("[PATCH community events] group chat sync failed:", chatError);
  }

  // Casts match the repo-wide untyped supabase-js baseline (see next.config.js).
  const previousUrl = (existing as unknown as { cover_image_url?: string | null } | null)?.cover_image_url ?? null;
  const nextUrl = (data as unknown as { cover_image_url?: string | null } | null)?.cover_image_url ?? null;
  if (previousUrl && shouldDeletePreviousR2Asset(previousUrl, nextUrl)) {
    // Cover replaced with a new image — delete the old one unless another
    // event still references it.
    await deleteOwnedR2AssetIfUnique(db, previousUrl, [{ table: "community_events", column: "cover_image_url" }]);
  } else if (previousUrl && nextUrl === null) {
    // Cover removed entirely — the update already nulled it, so delete the
    // object unless another row still references it.
    await deleteR2AssetIfUnreferenced(db, previousUrl, [{ table: "community_events", column: "cover_image_url" }]);
  }

  const announcements = [
    { room: realtimeRooms.events(communityId), topic: "event", data },
  ];
  if (chatCommunityId) {
    // The room's own members are looking at the Event card beside their chat,
    // not at the event page the edit was made on — the same row goes out on
    // the room's events topic so that card follows the change.
    announcements.push({ room: realtimeRooms.events(chatCommunityId), topic: "event", data });
  }
  void publishRealtimeBatch(announcements);

  const [enriched] = await enrichEventCards([data as unknown as Record<string, unknown>], userId);
  return NextResponse.json({ event: enriched });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  let existingQuery = db
    .from("community_events")
    .select("id, user_id")
    .eq("id", eventId);
  existingQuery = publicScope
    ? existingQuery.eq("is_public", true).is("community_id", null)
    : existingQuery.eq("community_id", communityId);
  const { data: existing } = await existingQuery.maybeSingle();

  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "Not the event owner." }, { status: 403 });

  const { data: eventRow } = await db
    .from("community_events")
    .select("id, cover_image_url")
    .eq("id", eventId)
    .maybeSingle();

  // The event's group chat outlives its event: its members keep the room and
  // the conversation in it and only lose what pointed at the event (see
  // 20260925140000_event_delete_keeps_group_chat). The link is cleared before
  // the delete so the room survives even where the old `on delete cascade`
  // constraint is still in place — nothing points at the row by the time it
  // goes, so nothing cascades.
  // `as never` matches the repo-wide untyped supabase-js baseline for writes the
  // generated client types don't know about (see the push/settings routes).
  const { data: roomRow, error: unlinkError } = await db
    .from("communities")
    .update({ event_id: null } as never)
    .eq("event_id", eventId)
    .select("id")
    .maybeSingle();
  if (unlinkError) {
    console.error("[DELETE community events] group chat unlink failed:", unlinkError);
  }
  const chatCommunityId = (roomRow as { id: string } | null)?.id ?? null;

  const { error } = await db.from("community_events").delete().eq("id", eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // communities.image_url is checked as well as community_events: the event's
  // group chat wears the event's cover as its own DP (see
  // ensureEventChatCommunity) and it is still standing, so deleting the event
  // must not take the image off the face of the room.
  await deleteR2AssetIfUnreferenced(db, eventRow?.cover_image_url, [
    { table: "community_events", column: "cover_image_url" },
    { table: "communities", column: "image_url" },
  ]);

  const announcements = [
    { room: realtimeRooms.events(communityId), topic: "event", data: { id: eventId } },
    {
      // Remove the timeline's permanent "created an event" card too.
      room: realtimeRooms.chat(communityId),
      topic: "content-delete",
      data: { id: eventId, community_id: communityId, kind: "event" },
    },
  ];
  if (chatCommunityId) {
    // The room's own members: the date badge on its DP and the Event card
    // beside its chat both read the link that just went away, so the room has
    // to hear about it too — the delete is usually made from the event's own
    // page or its community, not from inside the room.
    announcements.push(
      { room: realtimeRooms.events(chatCommunityId), topic: "event", data: { id: eventId } },
      {
        room: realtimeRooms.chat(chatCommunityId),
        topic: "content-delete",
        data: { id: eventId, community_id: chatCommunityId, kind: "event" },
      },
    );
  }
  void publishRealtimeBatch(announcements);

  // The room id rides back so the deleting client can drop its caches for the
  // room (meta, the event card beside its chat) without a reload.
  return NextResponse.json({ ok: true, chat_community_id: chatCommunityId });
}
