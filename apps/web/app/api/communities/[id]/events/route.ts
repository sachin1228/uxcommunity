import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { requireSession } from "@/lib/auth/session";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { normalizeUtcCursor, toUtcCursor } from "@/lib/communities/read-models";
import { enrichEventCards, EVENT_CARD_COLUMNS } from "@/lib/communities/event-cards";
import { contentEventPayload } from "@/lib/communities/content-events";

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
  let [rawPhase = "upcoming", eventDate, cursorId] = cursor?.split("|") ?? [];
  if (rawPhase !== "upcoming" && rawPhase !== "past") {
    timer.finish({ status: 400 });
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }
  if (eventDate) {
    if (!cursorId) {
      timer.finish({ status: 400 });
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    // Cloudflare decodes a '+' in a query value as a space, mangling UTC
    // offsets ("…+00:00" → "… 00:00"). Normalize to "Z" before parsing.
    eventDate = normalizeUtcCursor(eventDate) ?? eventDate;
    if (Number.isNaN(Date.parse(eventDate))) {
      timer.finish({ status: 400 });
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
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
  // The page RPC resolves the author and the like/RSVP/save counts; the shared
  // serializer adds the two it can't supply (comment count and the attendee
  // faces), so this feed hands EventCard the same complete row the event page does.
  let enriched;
  try {
    enriched = await timer.measure("event_cards_enrich", () => enrichEventCards(page, userId));
  } catch (error) {
    console.error("[GET community events]", error);
    timer.finish({ status: 500 });
    return NextResponse.json({ error: "Failed to fetch events." }, { status: 500 });
  }
  const last = page.at(-1);
  const hasMoreInPhase = (data?.length ?? 0) > EVENT_PAGE_SIZE;
  const nextCursor = hasMoreInPhase && last
    ? `${resultPhase}|${toUtcCursor(last.event_date as string)}|${last.id as string}`
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

  const accentColor = typeof body.accent_color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent_color.trim())
    ? body.accent_color.trim().toLowerCase()
    : null;

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
      accent_color: accentColor,
      is_public: isPublic,
    })
    .select(EVENT_CARD_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void publishRealtimeBatch([
    { room: realtimeRooms.events(communityId), topic: "event", data },
    {
      // The chat timeline's permanent "<name> created an event" card.
      room: realtimeRooms.chat(communityId),
      topic: "content-insert",
      data: contentEventPayload(data as Record<string, unknown>, "event"),
    },
  ]);

  const [enriched] = await enrichEventCards([data as unknown as Record<string, unknown>], userId);
  return NextResponse.json({ event: enriched }, { status: 201 });
}
