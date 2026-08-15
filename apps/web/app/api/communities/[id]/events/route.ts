import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { requireSession } from "@/lib/auth/session";
import { deferCommunityNotification, eventHref } from "@/lib/notifications";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";

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

  const [{ data: users }, { data: profiles }, aggregatesResult] = await Promise.all([
    db.from("users").select("id, name").in("id", authorIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", authorIds),
    callPerformanceRpc(db, "get_event_list_aggregates", {
      p_user_id: currentUserId,
      p_event_ids: eventIds,
    }),
  ]);

  if (aggregatesResult.error) {
    console.error("[event list aggregates]", aggregatesResult.error);
    throw new Error("Failed to load event interaction aggregates.");
  }

  const nameMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));
  const aggregateMap = new Map(
    (aggregatesResult.data ?? []).map((aggregate) => [aggregate.id, aggregate]),
  );

  return rows.map((row) => {
    const authorId = row.user_id as string;
    const aggregate = aggregateMap.get(row.id as string);
    return {
      ...row,
      users: nameMap[authorId]
        ? { name: nameMap[authorId], avatar_url: avatarMap[authorId] ?? null }
        : null,
      rsvp_count: Number(aggregate?.rsvp_count ?? 0),
      user_rsvped: aggregate?.user_rsvped === true,
      like_count: Number(aggregate?.like_count ?? 0),
      user_liked: aggregate?.user_liked === true,
      save_count: Number(aggregate?.save_count ?? 0),
      user_saved: aggregate?.user_saved === true,
    };
  });
}

const EVENT_PAGE_SIZE = 25;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = createServerTimer("GET /api/communities/[id]/events");
  let session;
  try { session = await timer.measure("auth", () => requireSession("user", { verifyActive: false })); } catch (e) {
    timer.finish({ status: (e as Response).status ?? 401 });
    return e as Response;
  }

  const { id: communityId } = await params;
  const userId = (session as { userId: string }).userId;
  const db = createServiceClient();

  const cursor = req.nextUrl.searchParams.get("cursor");
  const now = new Date().toISOString();
  const [rawPhase = "upcoming", eventDate, cursorId] = cursor?.split("|") ?? [];
  if (rawPhase !== "upcoming" && rawPhase !== "past") {
    timer.finish({ status: 400 });
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }
  if (eventDate && (!cursorId || Number.isNaN(Date.parse(eventDate)))) {
    timer.finish({ status: 400 });
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  const fetchPhase = (phase: "upcoming" | "past", date: string | null, id: string | null) =>
    callPerformanceRpc(db, "get_event_list_page", {
      p_community_id: communityId,
      p_user_id: userId,
      p_phase: phase,
      p_cursor_event_date: date,
      p_cursor_id: id,
      p_now: now,
      p_limit: EVENT_PAGE_SIZE + 1,
    });

  let resultPhase: "upcoming" | "past" = rawPhase;
  let result = await timer.measure("events_page_rpc", () => fetchPhase(resultPhase, eventDate ?? null, cursorId ?? null));
  if (!result.error && !cursor && resultPhase === "upcoming" && (result.data?.length ?? 0) === 0) {
    resultPhase = "past";
    result = await timer.measure("past_events_fallback_rpc", () => fetchPhase("past", null, null));
  }
  if (result.error?.code === "42501") {
    timer.finish({ status: 403 });
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }
  if (result.error) {
    timer.finish({ status: 500 });
    return NextResponse.json({ error: "Failed to fetch events." }, { status: 500 });
  }

  const data = (result.data ?? []).map(({ item }) => item as Record<string, unknown>);
  const page = data.slice(0, EVENT_PAGE_SIZE);
  const enriched = page;
  const last = page.at(-1);
  const hasMoreInPhase = (data?.length ?? 0) > EVENT_PAGE_SIZE;
  const nextCursor = hasMoreInPhase && last
    ? `${resultPhase}|${last.event_date as string}|${last.id as string}`
    : resultPhase === "upcoming"
      ? "past"
      : null;
  const body = { events: enriched, nextCursor };
  timer.finish({ status: 200, response_bytes: estimateJsonBytes(body), returned_rows: enriched.length });
  return NextResponse.json(body);
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

  deferCommunityNotification({
    communityId,
    actorId: userId,
    type: "community_event",
    entityType: "event",
    entityId: data.id,
    title: (actorName) => `${actorName} created a new event`,
    body: title,
    href: eventHref(communityId, data.id),
    metadata: { event_date: eventDate },
  });

  const [enriched] = await enrichEvents(db, [data as unknown as Record<string, unknown>], userId);
  return NextResponse.json({ event: enriched }, { status: 201 });
}
