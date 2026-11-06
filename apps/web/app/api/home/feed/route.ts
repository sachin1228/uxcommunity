import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import type { Json } from "@/lib/supabase/performance-rpcs";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { HOME_FEED_SCOPES, type HomeFeedScope } from "@/lib/feeds/home-feed-options";
import { parseHomeFeedCursor } from "@/lib/feeds/home-feed-cursor";
import { loadHomeFeedPage } from "@/lib/home/home-feed-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const timer = createServerTimer("GET /api/home/feed");
  let session;
  try {
    session = await timer.measure("auth", () =>
      requireSession("user", { allowUnverified: true }),
    );
  } catch (error) {
    timer.finish({ status: (error as Response).status ?? 401 });
    return error as Response;
  }

  const cursor = parseHomeFeedCursor(
    req.nextUrl.searchParams.get("before"),
    req.nextUrl.searchParams.get("before_id"),
  );
  if (!cursor.ok) {
    timer.finish({ status: 400 });
    return NextResponse.json(
      { error: "Invalid feed cursor." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Unknown or missing values fall back to `all`, the unified default feed
  // (joined communities plus public posts). The dashboard sends its active
  // filter explicitly; older clients that send no scope get the same single
  // feed instead of the pre-unification every-public-post list.
  const rawScope = req.nextUrl.searchParams.get("scope") ?? "all";
  const scope: HomeFeedScope = (HOME_FEED_SCOPES as readonly string[]).includes(rawScope)
    ? (rawScope as HomeFeedScope)
    : "all";

  let items: Json[];
  try {
    items = await timer.measure("feed_page_rpc", () =>
      loadHomeFeedPage(session.userId!, cursor.before, cursor.beforeId, scope),
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
