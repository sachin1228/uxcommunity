import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { HOME_FEED_TAG } from "@/lib/home-feed-cache";
import { HOME_FEED_SCOPES, type HomeFeedScope } from "@/lib/feeds/home-feed-options";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { loadEventAttendeePreviews } from "@/lib/communities/event-cards";
import {
  FEED_PAGE_SIZE as PAGE_SIZE,
  isFeedCard,
  normalizeFeedCard,
  type FeedCardObject,
} from "@/lib/feeds/feed-items";

export const dynamic = "force-dynamic";

// The home feed is read by every user on every dashboard visit. Recomputing it
// per request runs ~30 × ~6 correlated count subqueries in get_home_feed_page,
// which is heavy for the free-tier micro compute and the 5GB egress budget.
// unstable_cache dedupes identical (user, cursor) reads for 10s, collapsing N
// concurrent page loads into a single DB round-trip. 10s is short enough that
// new posts / own likes appear almost immediately.
const loadFeedPage = unstable_cache(
  async (userId: string, before: string | null, scope: HomeFeedScope) => {
    const db = createServiceClient();
    const { data, error } = await callPerformanceRpc(
      db,
      "get_home_feed_page",
      {
        p_user_id: userId,
        p_before: before,
        p_limit: PAGE_SIZE,
        p_scope: scope,
      },
    );
    if (error) throw error;

    // Keep this boundary defensive while older databases still have the
    // pre-simplification mixed-content RPC installed. Community-public cards
    // remain part of the homepage, while old standalone event/resource/
    // showcase records are intentionally left out.
    let items = (data ?? [])
      .map(({ item }) => item)
      .filter(isFeedCard)
      .map(normalizeFeedCard);

    // Attach poll vote totals so feed thread cards show live counts.
    const threadObjects = items.filter((item): item is FeedCardObject =>
      isFeedCard(item) && item._type === "thread",
    );
    if (threadObjects.length) {
      const attached = await attachPollVotes(
        db,
        threadObjects as unknown as Array<Record<string, unknown>>,
        userId,
      );
      const byId = new Map<string, FeedCardObject>();
      for (const row of attached) {
        if (typeof row.id === "string") byId.set(row.id, row as unknown as FeedCardObject);
      }
      items = items.map((item) =>
        isFeedCard(item) && item._type === "thread" && typeof item.id === "string" && byId.has(item.id)
          ? byId.get(item.id)!
          : item,
      );
    }

    const eventIds = items.flatMap((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        && item._type === "event" && typeof item.id === "string"
        ? [item.id]
        : [],
    );
    if (!eventIds.length) return items;

    // Same attendee previews every other event surface uses.
    const previewMap = await loadEventAttendeePreviews(eventIds);

    // The group-chat row on the feed's event cards: the room behind each event
    // (when one exists) plus whether the viewer is already in it. Two batched
    // reads for the whole page — the rooms, then the viewer's memberships.
    const { data: roomRows } = await db
      .from("communities")
      .select("id, event_id, name, image_url, member_count")
      .in("event_id", eventIds)
      .eq("is_active", true);
    const roomByEvent = new Map<
      string,
      { id: string; name: string; image_url: string | null; member_count: number }
    >();
    for (const room of (roomRows ?? []) as Array<{
      id: string;
      event_id: string | null;
      name: string;
      image_url: string | null;
      member_count: number;
    }>) {
      if (room.event_id) roomByEvent.set(room.event_id, room);
    }
    const joinedRoomIds = new Set<string>();
    if (roomByEvent.size) {
      const { data: memberships } = await db
        .from("community_members")
        .select("community_id")
        .eq("user_id", userId)
        .in("community_id", [...roomByEvent.values()].map((room) => room.id));
      for (const membership of (memberships ?? []) as Array<{ community_id: string }>) {
        joinedRoomIds.add(membership.community_id);
      }
    }
    const chatFor = (eventId: string) => {
      const room = roomByEvent.get(eventId);
      if (!room) return null;
      return {
        id: room.id,
        name: room.name,
        image_url: room.image_url,
        member_count: room.member_count,
        joined: joinedRoomIds.has(room.id),
      };
    };

    return items.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        && item._type === "event" && typeof item.id === "string"
        ? {
            ...item,
            rsvps: (previewMap.get(item.id) ?? []) as unknown as Json,
            chat_community: chatFor(item.id),
          }
        : item,
    );
  },
  ["home-feed", HOME_FEED_TAG],
  { revalidate: 10, tags: [HOME_FEED_TAG] },
);

export async function GET(req: NextRequest) {
  const timer = createServerTimer("GET /api/home/feed");
  let session;
  try {
    session = await timer.measure("auth", () =>
      requireSession("user", { verifyActive: false }),
    );
  } catch (error) {
    timer.finish({ status: (error as Response).status ?? 401 });
    return error as Response;
  }

  const before = req.nextUrl.searchParams.get("before");
  if (before && Number.isNaN(Date.parse(before))) {
    timer.finish({ status: 400 });
    return NextResponse.json(
      { error: "Invalid feed cursor." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Unknown or missing values fall back to `all`, the legacy every-public-post
  // feed, so clients that send no scope (the Expo home feed) and stale clients
  // keep working. The dashboard sends `public` or `communities` explicitly.
  const rawScope = req.nextUrl.searchParams.get("scope") ?? "all";
  const scope: HomeFeedScope = (HOME_FEED_SCOPES as readonly string[]).includes(rawScope)
    ? (rawScope as HomeFeedScope)
    : "all";

  let items: Json[];
  try {
    items = await timer.measure("feed_page_rpc", () =>
      loadFeedPage(session.userId!, before, scope),
    );
  } catch (error) {
    console.error("[GET home feed]", error);
    timer.finish({ status: 500 });
    return NextResponse.json(
      { error: "Failed to load the latest posts." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = { items };
  const timing = timer.finish({
    status: 200,
    query_count: 1,
    returned_rows: items.length,
    response_bytes: estimateJsonBytes(body),
  });

  const response = NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
  response.headers.set("Server-Timing", timing);
  return response;
}
