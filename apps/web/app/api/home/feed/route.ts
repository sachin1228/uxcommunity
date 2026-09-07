import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { attachPollVotes } from "@/lib/threads/poll-votes";

const PAGE_SIZE = 30;

export const dynamic = "force-dynamic";

type HomeFeedObject = { [key: string]: Json | undefined };

function isHomeFeedItem(item: Json): item is HomeFeedObject {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const kind = item._type;
  return (kind === "thread" || kind === "event" || kind === "resource" || kind === "showcase")
    && item.community_id !== null && item.community_id !== undefined;
}

function normalizeHomeFeedItem(item: HomeFeedObject): Json {
  return {
    ...item,
    ...(item._type === "thread" ? {
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      links: Array.isArray(item.links) ? item.links : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
    } : {}),
  };
}

// The home feed is read by every user on every dashboard visit. Recomputing it
// per request runs ~30 × ~6 correlated count subqueries in get_home_feed_page,
// which is heavy for the free-tier micro compute and the 5GB egress budget.
// unstable_cache dedupes identical (user, cursor) reads for 10s, collapsing N
// concurrent page loads into a single DB round-trip. 10s is short enough that
// new posts / own likes appear almost immediately.
const loadFeedPage = unstable_cache(
  async (userId: string, before: string | null) => {
    const db = createServiceClient();
    const { data, error } = await callPerformanceRpc(
      db,
      "get_home_feed_page",
      { p_user_id: userId, p_before: before, p_limit: PAGE_SIZE },
    );
    if (error) throw error;

    // Keep this boundary defensive while older databases still have the
    // pre-simplification mixed-content RPC installed. Community-public cards
    // remain part of the homepage, while old standalone event/resource/
    // showcase records are intentionally left out.
    let items = (data ?? [])
      .map(({ item }) => item)
      .filter(isHomeFeedItem)
      .map(normalizeHomeFeedItem);

    // Attach poll vote totals so feed thread cards show live counts.
    const threadObjects = items.filter((item): item is HomeFeedObject =>
      isHomeFeedItem(item) && item._type === "thread",
    );
    if (threadObjects.length) {
      const attached = await attachPollVotes(
        db,
        threadObjects as unknown as Array<Record<string, unknown>>,
        userId,
      );
      const byId = new Map<string, HomeFeedObject>();
      for (const row of attached) {
        if (typeof row.id === "string") byId.set(row.id, row as unknown as HomeFeedObject);
      }
      items = items.map((item) =>
        isHomeFeedItem(item) && item._type === "thread" && typeof item.id === "string" && byId.has(item.id)
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

    const previews = await callPerformanceRpc(db, "get_event_attendee_previews", {
      p_event_ids: eventIds,
      p_limit: 5,
    });
    if (previews.error) throw previews.error;
    const previewMap = new Map((previews.data ?? []).map((preview) => [preview.id, preview.rsvps]));

    return items.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        && item._type === "event" && typeof item.id === "string"
        ? { ...item, rsvps: previewMap.get(item.id) ?? [] }
        : item,
    );
  },
  ["home-feed"],
  { revalidate: 10 },
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

  let items: Json[];
  try {
    items = await timer.measure("feed_page_rpc", () =>
      loadFeedPage(session.userId!, before),
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
  timer.finish({
    status: 200,
    query_count: 1,
    returned_rows: items.length,
    response_bytes: estimateJsonBytes(body),
  });

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
