import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { eventHref, getActorName, notifyCommunityMembers } from "@/lib/notifications";

async function isMember(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
  userId: string,
) {
  const { data } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function enrichEvents(
  db: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>,
  currentUserId: string,
) {
  if (!rows.length) return [];

  const eventIds = rows.map((r) => r.id as string);
  const authorIds = [...new Set(rows.map((r) => r.user_id as string))];

  const [
    { data: users },
    { data: profiles },
    { data: allRsvps },
    { data: myRsvps },
    { data: allSaves },
    { data: mySaves },
  ] = await Promise.all([
    db.from("users").select("id, name").in("id", authorIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", authorIds),
    db.from("event_rsvps").select("event_id").in("event_id", eventIds),
    db.from("event_rsvps").select("event_id").in("event_id", eventIds).eq("user_id", currentUserId),
    db.from("event_saves").select("event_id").in("event_id", eventIds),
    db.from("event_saves").select("event_id").in("event_id", eventIds).eq("user_id", currentUserId),
  ]);

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));
  const rsvpCounts = (allRsvps ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.event_id] = (acc[r.event_id] ?? 0) + 1;
    return acc;
  }, {});
  const myRsvpSet = new Set((myRsvps ?? []).map((r) => r.event_id));
  const saveCounts = (allSaves ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.event_id] = (acc[r.event_id] ?? 0) + 1;
    return acc;
  }, {});
  const mySaveSet = new Set((mySaves ?? []).map((r) => r.event_id));

  return rows.map((row) => {
    const authorId = row.user_id as string;
    return {
      ...row,
      users: nameMap[authorId]
        ? { name: nameMap[authorId], avatar_url: avatarMap[authorId] ?? null }
        : null,
      rsvp_count: rsvpCounts[row.id as string] ?? 0,
      user_rsvped: myRsvpSet.has(row.id as string),
      save_count: saveCounts[row.id as string] ?? 0,
      user_saved: mySaveSet.has(row.id as string),
    };
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  if (!(await isMember(db, communityId, userId))) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  const { data, error } = await db
    .from("community_events")
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, created_at, updated_at")
    .eq("community_id", communityId)
    .order("event_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enriched = await enrichEvents(db, (data ?? []) as Array<Record<string, unknown>>, userId);
  return NextResponse.json({ events: enriched });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  if (!(await isMember(db, communityId, userId))) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 120) {
    return NextResponse.json({ error: "Title is required (max 120 characters)." }, { status: 422 });
  }

  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim()
    : null;
  if (description && description.length > 5000) {
    return NextResponse.json({ error: "Description is too long (max 5000 characters)." }, { status: 422 });
  }

  const eventDate = typeof body.event_date === "string" ? body.event_date : null;
  if (!eventDate || isNaN(Date.parse(eventDate))) {
    return NextResponse.json({ error: "A valid event date is required." }, { status: 422 });
  }

  const endDate = typeof body.end_date === "string" && body.end_date ? body.end_date : null;
  if (endDate && isNaN(Date.parse(endDate))) {
    return NextResponse.json({ error: "Invalid end date." }, { status: 422 });
  }
  if (endDate && new Date(endDate) <= new Date(eventDate)) {
    return NextResponse.json({ error: "End time must be after the start time." }, { status: 422 });
  }

  const isOnline = body.is_online === true;
  const location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : null;
  const meetLink = typeof body.meet_link === "string" && body.meet_link.trim() ? body.meet_link.trim() : null;
  if (meetLink) {
    try { const u = new URL(meetLink); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); }
    catch { return NextResponse.json({ error: "Meet link must be a valid URL." }, { status: 422 }); }
  }

  const maxAttendees = typeof body.max_attendees === "number" && body.max_attendees > 0
    ? Math.floor(body.max_attendees)
    : null;

  const rawCoverImageUrl = typeof body.cover_image_url === "string" && body.cover_image_url.trim()
    ? body.cover_image_url.trim()
    : null;
  const isPublic = body.is_public === true;

  const { data, error } = await db
    .from("community_events")
    .insert({
      community_id: communityId,
      user_id: userId,
      title,
      description,
      event_date: eventDate,
      end_date: endDate,
      is_online: isOnline,
      location,
      meet_link: meetLink,
      max_attendees: maxAttendees,
      cover_image_url: rawCoverImageUrl,
      is_public: isPublic,
    })
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, is_public, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const actorName = await getActorName(db, userId);
  await notifyCommunityMembers(db, {
    communityId,
    actorId: userId,
    type: "community_event",
    entityType: "event",
    entityId: data.id,
    title: `${actorName} created a new event`,
    body: title,
    href: eventHref(communityId, data.id),
    metadata: { event_date: eventDate },
  });

  const [enriched] = await enrichEvents(db, [data as unknown as Record<string, unknown>], userId);
  return NextResponse.json({ event: enriched }, { status: 201 });
}
