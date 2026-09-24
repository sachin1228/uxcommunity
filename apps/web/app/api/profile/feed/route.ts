import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc, isProfileFeedScope, type Json } from "@/lib/supabase/performance-rpcs";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { loadEventAttendeePreviews } from "@/lib/communities/event-cards";
import {
  FEED_PAGE_SIZE,
  isFeedCard,
  normalizeFeedCard,
  type FeedCardObject,
} from "@/lib/feeds/feed-items";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile/feed?scope=all|thread|showcase|resource|event|saved
 *
 * The profile activity tabs. Returns the same card payloads as
 * /api/home/feed — `get_profile_feed_page` mirrors the home feed RPC and keeps
 * its projection in sync — so threads, showcase posts, resources and events
 * render through the identical client card components on both surfaces, and
 * every like/save/edit/delete goes through the same community API routes into
 * the same tables. There is exactly one copy of each card and one source of
 * truth in the database.
 */
export async function GET(req: NextRequest) {
  const timer = createServerTimer("GET /api/profile/feed");
  let session;
  try {
    session = await timer.measure("auth", () =>
      requireSession("user", { verifyActive: false }),
    );
  } catch (error) {
    timer.finish({ status: (error as Response).status ?? 401 });
    return error as Response;
  }

  const scopeParam = req.nextUrl.searchParams.get("scope") ?? "all";
  if (!isProfileFeedScope(scopeParam)) {
    timer.finish({ status: 400 });
    return NextResponse.json(
      { error: "Unknown profile feed scope." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const before = req.nextUrl.searchParams.get("before");
  if (before && Number.isNaN(Date.parse(before))) {
    timer.finish({ status: 400 });
    return NextResponse.json(
      { error: "Invalid feed cursor." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const userId = session.userId!;
  const db = createServiceClient();

  let items: Json[];
  try {
    items = await timer.measure("profile_feed_page_rpc", async () => {
      const { data, error } = await callPerformanceRpc(db, "get_profile_feed_page", {
        p_user_id: userId,
        p_scope: scopeParam,
        p_before: before,
        p_limit: FEED_PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? [])
        .map(({ item }) => item)
        .filter(isFeedCard)
        .map(normalizeFeedCard);
    });

    items = await timer.measure("thread_poll_votes", async () => {
      const threadObjects = items.filter((item): item is FeedCardObject =>
        isFeedCard(item) && item._type === "thread",
      );
      if (!threadObjects.length) return items;
      const attached = await attachPollVotes(
        db,
        threadObjects as unknown as Array<Record<string, unknown>>,
        userId,
      );
      const byId = new Map<string, FeedCardObject>();
      for (const row of attached) {
        if (typeof row.id === "string") byId.set(row.id, row as unknown as FeedCardObject);
      }
      return items.map((item) =>
        isFeedCard(item) && item._type === "thread" && typeof item.id === "string" && byId.has(item.id)
          ? byId.get(item.id)!
          : item,
      );
    });

    items = await timer.measure("event_attendee_previews", async () => {
      const eventIds = items.flatMap((item) =>
        isFeedCard(item) && item._type === "event" && typeof item.id === "string" ? [item.id] : [],
      );
      if (!eventIds.length) return items;
      // Same attendee previews every other event surface uses.
      const previewMap = await loadEventAttendeePreviews(eventIds);
      return items.map((item) =>
        isFeedCard(item) && item._type === "event" && typeof item.id === "string"
        ? { ...item, rsvps: (previewMap.get(item.id) ?? []) as unknown as Json }
        : item,
      );
    });
  } catch (error) {
    console.error("[GET profile feed]", error);
    timer.finish({ status: 500 });
    return NextResponse.json(
      { error: "Failed to load your posts." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = { items };
  timer.finish({
    status: 200,
    returned_rows: items.length,
    response_bytes: estimateJsonBytes(body),
  });

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
