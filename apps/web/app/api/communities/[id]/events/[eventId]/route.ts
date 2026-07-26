import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

async function enrichOne(
  db: ReturnType<typeof createServiceClient>,
  row: Record<string, unknown>,
  currentUserId: string,
) {
  const eventId = row.id as string;
  const authorId = row.user_id as string;

  const [
    { data: userRow },
    { data: profileRow },
    { data: allRsvps },
    { data: myRsvp },
  ] = await Promise.all([
    db.from("users").select("id, name").eq("id", authorId).maybeSingle(),
    db.from("designer_profiles").select("user_id, avatar_url").eq("user_id", authorId).maybeSingle(),
    db.from("event_rsvps").select("user_id").eq("event_id", eventId),
    db.from("event_rsvps").select("event_id").eq("event_id", eventId).eq("user_id", currentUserId).maybeSingle(),
  ]);

  return {
    ...row,
    users: userRow ? { name: userRow.name, avatar_url: profileRow?.avatar_url ?? null } : null,
    rsvp_count: (allRsvps ?? []).length,
    user_rsvped: Boolean(myRsvp),
  };
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

  const { data, error } = await db
    .from("community_events")
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, created_at, updated_at")
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  const enriched = await enrichOne(db, data as unknown as Record<string, unknown>, userId);
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

  const { data: existing } = await db
    .from("community_events")
    .select("id, user_id")
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

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

  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 422 });

  const { data, error } = await db
    .from("community_events")
    .update(patch)
    .eq("id", eventId)
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enriched = await enrichOne(db, data as unknown as Record<string, unknown>, userId);
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

  const { data: existing } = await db
    .from("community_events")
    .select("id, user_id")
    .eq("id", eventId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (existing.user_id !== userId) return NextResponse.json({ error: "Not the event owner." }, { status: 403 });

  const { error } = await db.from("community_events").delete().eq("id", eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
