import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";

const PAGE_SIZE = 30;

export const dynamic = "force-dynamic";

function isHomeThread(item: Json): item is { [key: string]: Json | undefined } {
  return typeof item === "object"
    && item !== null
    && !Array.isArray(item)
    && item._type === "thread"
    && item.community_id === null;
}

function normalizeHomeThread(item: { [key: string]: Json | undefined }): Json {
  return {
    ...item,
    attachments: Array.isArray(item.attachments) ? item.attachments : [],
    links: Array.isArray(item.links) ? item.links : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
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
    // pre-simplification mixed-content RPC installed. The migration narrows
    // the SQL query too, but the route must never pass legacy non-thread cards
    // to the thread-only homepage.
    return (data ?? [])
      .map(({ item }) => item)
      .filter(isHomeThread)
      .map(normalizeHomeThread);
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
