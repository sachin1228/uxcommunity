import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { deleteR2AssetIfUnreferenced, deleteOwnedR2AssetIfUnique, shouldDeletePreviousR2Asset } from "@/lib/r2";
import { enrichEventCards, EVENT_CARD_COLUMNS } from "@/lib/communities/event-cards";
import { syncEventChatCommunity } from "@/lib/communities/event-chat";

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
    // from R2 after the update.
    .select("id, user_id, cover_image_url")
    .eq("id", eventId);
  existingQuery = publicScope
    ? existingQuery.eq("is_public", true).is("community_id", null)
    : existingQuery.eq("community_id", communityId);
  const { data: existing } = await existingQuery.maybeSingle();

  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "Not the event owner." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  const patch: Record<string, unknown> = {};

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title || title.length > 120) return NextResponse.json({ error: "Title is required (max 120 characters)." }, { status: 422 });
    patch.title = title;
  }
  if ("description" in body) {
    patch.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    if (patch.description && (patch.description as string).length > 5000) return NextResponse.json({ error: "Description too long." }, { status: 422 });
  }
  if (typeof body.event_date === "string") {
    if (isNaN(Date.parse(body.event_date))) return NextResponse.json({ error: "Invalid event date." }, { status: 422 });
    patch.event_date = body.event_date;
  }
  if ("end_date" in body) {
    const ed = typeof body.end_date === "string" && body.end_date ? body.end_date : null;
    if (ed && isNaN(Date.parse(ed))) return NextResponse.json({ error: "Invalid end date." }, { status: 422 });
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
  try {
    await syncEventChatCommunity(
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

  void publishRealtimeBatch([
    { room: realtimeRooms.events(communityId), topic: "event", data },
  ]);

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

  const { error } = await db.from("community_events").delete().eq("id", eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await deleteR2AssetIfUnreferenced(db, eventRow?.cover_image_url, [
    { table: "community_events", column: "cover_image_url" },
  ]);

  void publishRealtimeBatch([
    { room: realtimeRooms.events(communityId), topic: "event", data: { id: eventId } },
    {
      // Remove the timeline's permanent "created an event" card too.
      room: realtimeRooms.chat(communityId),
      topic: "content-delete",
      data: { id: eventId, community_id: communityId, kind: "event" },
    },
  ]);

  return NextResponse.json({ ok: true });
}
