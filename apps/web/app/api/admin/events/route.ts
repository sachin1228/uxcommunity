import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

const PAGE_SIZE = 25;

const STATUS_VALUES = new Set(["all", "upcoming", "live", "ended"]);

/**
 * The events moderation queue: every event on the platform, newest first,
 * with the host, the community that ran it, its group chat, the RSVP count
 * and the lifecycle — enough for an admin to judge an event and remove a fake
 * or spam one.
 *
 * The state vocabulary is the one the member surfaces derive (see
 * lib/communities/event-date.ts): an event is `live` from its start up to its
 * end, and `ended` once the window closes — an event with no recorded end is
 * over the moment it starts, the same stand-in `hasEventEnded` uses. Upcoming
 * is everything before the start.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;

  const requestedStatus = searchParams.get("status") ?? "all";
  const status = STATUS_VALUES.has(requestedStatus) ? requestedStatus : "all";

  // Commas/parens would break the PostgREST or() expression; strip them rather
  // than 500 on a pasted title.
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80).replace(/[,()]/g, " ");

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const now = new Date().toISOString();

  // Search spans the event title and the names the row displays. PostgREST
  // cannot OR across related tables, so matching host/community ids resolve
  // first and ride the or() as id lists (same shape as the admin jobs queue).
  let hostIds: string[] = [];
  let communityIds: string[] = [];
  if (search) {
    const [hostHits, communityHits] = await Promise.all([
      db
        .from("users")
        .select("id")
        .or(`name.ilike.%${search}%,email.ilike.%${search}%`)
        .limit(100),
      db.from("communities").select("id").ilike("name", `%${search}%`).limit(100),
    ]);
    hostIds = (hostHits.data ?? []).map((row) => row.id);
    communityIds = (communityHits.data ?? []).map((row) => row.id);
  }

  /** Every active filter except status — reused for the tab counts. */
  function applySearch(query: any): any {
    if (!search) return query;
    const parts = [`title.ilike.%${search}%`];
    if (hostIds.length) parts.push(`user_id.in.(${hostIds.join(",")})`);
    if (communityIds.length) parts.push(`community_id.in.(${communityIds.join(",")})`);
    return query.or(parts.join(","));
  }

  /**
   * The three lifecycle buckets, each the exact predicate the member badge
   * derives: live runs [start, end), ended covers everything from the end
   * on — and a NULL end makes the start the deadline, so a window nobody
   * recorded ends when it opens.
   */
  function applyState(query: any, state: string): any {
    if (state === "upcoming") return query.gt("event_date", now);
    if (state === "live") {
      return query
        .not("end_date", "is", null)
        .lte("event_date", now)
        .gt("end_date", now);
    }
    if (state === "ended") {
      // start <= now AND (no end OR end <= now) — with end > start by
      // constraint, a lapsed end implies a lapsed start.
      return query.lte("event_date", now).or(`end_date.is.null,end_date.lte.${now}`);
    }
    return query;
  }

  const columns =
    "id, title, description, event_date, end_date, is_online, is_public, location, meet_link, " +
    "max_attendees, cover_image_url, city_id, community_id, user_id, created_at, updated_at";

  const listQuery = applyState(applySearch(db.from("community_events").select(columns, { count: "exact" })), status)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [listResult, upcomingCount, liveCount, endedCount] = await Promise.all([
    listQuery,
    applyState(applySearch(db.from("community_events").select("id", { count: "exact", head: true })), "upcoming"),
    applyState(applySearch(db.from("community_events").select("id", { count: "exact", head: true })), "live"),
    applyState(applySearch(db.from("community_events").select("id", { count: "exact", head: true })), "ended"),
  ]);

  if (listResult.error) {
    console.error("[admin/events] GET error:", listResult.error);
    return NextResponse.json({ error: "Failed to fetch events." }, { status: 500 });
  }

  // The typed client cannot narrow a dynamic select string, so the page rows
  // are asserted to the contract the `columns` list above selects.
  interface EventListRow {
    id: string;
    title: string;
    description: string | null;
    event_date: string;
    end_date: string | null;
    is_online: boolean;
    is_public: boolean;
    location: string | null;
    meet_link: string | null;
    max_attendees: number | null;
    cover_image_url: string | null;
    city_id: string | null;
    community_id: string;
    user_id: string;
    created_at: string;
    updated_at: string;
  }

  const rows = (listResult.data ?? []) as unknown as EventListRow[];
  const eventIds = rows.map((row) => row.id);
  const hostUserIds = [...new Set(rows.map((row) => row.user_id))];
  const communityIdsInPage = [...new Set(rows.map((row) => row.community_id))];
  const cityIds = [...new Set(rows.map((row) => row.city_id).filter((id): id is string => Boolean(id)))];

  // Names, rooms and RSVP tallies in one parallel batch — a page of N events
  // costs four queries, not four per row.
  const [hostsRead, communitiesRead, citiesRead, roomsRead, rsvpsRead] = await Promise.all([
    hostUserIds.length
      ? db.from("users").select("id, name, email").in("id", hostUserIds)
      : Promise.resolve({ data: [], error: null }),
    communityIdsInPage.length
      ? db.from("communities").select("id, name").in("id", communityIdsInPage)
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? db.from("cities").select("id, name").in("id", cityIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? db.from("communities").select("id, name, member_count, event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? db.from("event_rsvps").select("event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const hostMap = new Map((hostsRead.data ?? []).map((row) => [row.id, row]));
  const communityMap = new Map((communitiesRead.data ?? []).map((row) => [row.id, row]));
  const cityMap = new Map((citiesRead.data ?? []).map((row) => [row.id, row]));

  // A room wears event_id = the event it belongs to; that is the whole link
  // (see 20260924130000_event_chat_communities.sql).
  const roomByEvent = new Map(
    (roomsRead.data ?? [])
      .filter((row) => row.event_id)
      .map((row) => [row.event_id as string, { id: row.id, name: row.name, member_count: row.member_count }])
  );

  const rsvpCounts = new Map<string, number>();
  for (const row of rsvpsRead.data ?? []) {
    rsvpCounts.set(row.event_id, (rsvpCounts.get(row.event_id) ?? 0) + 1);
  }

  const nowMs = Date.parse(now);
  const events = rows.map((row) => {
    const startMs = Date.parse(row.event_date);
    const endMs = row.end_date ? Date.parse(row.end_date) : startMs;
    const state = nowMs < startMs ? "upcoming" : nowMs < endMs ? "live" : "ended";
    const host = hostMap.get(row.user_id);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      state,
      event_date: row.event_date,
      end_date: row.end_date,
      is_online: row.is_online,
      is_public: row.is_public,
      location: row.location,
      meet_link: row.meet_link,
      max_attendees: row.max_attendees,
      cover_image_url: row.cover_image_url,
      created_at: row.created_at,
      updated_at: row.updated_at,
      city_name: row.city_id ? (cityMap.get(row.city_id)?.name ?? null) : null,
      host: host ? { id: host.id, name: host.name, email: host.email } : null,
      community: communityMap.get(row.community_id)?.name ?? "Unknown community",
      room: roomByEvent.get(row.id) ?? null,
      rsvp_count: rsvpCounts.get(row.id) ?? 0,
    };
  });

  return NextResponse.json({
    events,
    total: listResult.count ?? 0,
    counts: {
      upcoming: upcomingCount.error ? 0 : (upcomingCount.count ?? 0),
      live: liveCount.error ? 0 : (liveCount.count ?? 0),
      ended: endedCount.error ? 0 : (endedCount.count ?? 0),
    },
  });
}
