import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { createServerTimer } from "@/lib/server-timing";

type InteractionCounts = {
  threads: Record<string, { comment_count: number; vote_count: number; user_voted: boolean; user_saved: boolean }>;
  events: Record<string, { comment_count: number; rsvp_count: number; user_rsvped: boolean; like_count: number; user_liked: boolean; save_count: number; user_saved: boolean }>;
  resources: Record<string, { comment_count: number; save_count: number; user_saved: boolean; bookmark_count: number; user_bookmarked: boolean }>;
};

const PAGE_SIZE = 30;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const timer = createServerTimer("GET /api/home/feed");
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  timer.checkpoint("auth");
  const userId = session.userId!;
  const db = createServiceClient();

  const before = req.nextUrl.searchParams.get("before") ?? null;

  let threadsQ = db
    .from("community_threads")
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, is_public, created_at, updated_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  let eventsQ = db
    .from("community_events")
    .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, is_public, created_at, updated_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  let resourcesQ = db
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, tags, is_public, created_at, updated_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (before) {
    threadsQ   = threadsQ.lt("created_at", before);
    eventsQ    = eventsQ.lt("created_at", before);
    resourcesQ = resourcesQ.lt("created_at", before);
  }

  const [threadsResult, eventsResult, resourcesResult] = await Promise.all([
    timer.measure("threads_query", async () => await threadsQ),
    timer.measure("events_query", async () => await eventsQ),
    timer.measure("resources_query", async () => await resourcesQ),
  ]);

  const feedError = threadsResult.error ?? eventsResult.error ?? resourcesResult.error;
  if (feedError) {
    console.error("[GET home feed]", feedError);
    return NextResponse.json(
      { error: "Failed to load the latest posts." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const threads = threadsResult.data;
  const events = eventsResult.data;
  const resources = resourcesResult.data;

  // Merge and sort newest-first, take top PAGE_SIZE
  const all = ([
    ...((threads ?? []) as Array<Record<string, any>>).map((t) => ({ ...t, _type: "thread" as const })),
    ...((events ?? []) as Array<Record<string, any>>).map((e) => ({ ...e, _type: "event" as const })),
    ...((resources ?? []) as Array<Record<string, any>>).map((r) => ({ ...r, _type: "resource" as const })),
  ] as Array<Record<string, any> & {
    _type: "thread" | "event" | "resource";
  }>)
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
    .slice(0, PAGE_SIZE);

  if (!all.length) {
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Collect IDs for batch enrichment
  const userIds      = [...new Set(all.map((i) => i.user_id))];
  const communityIds = [...new Set(all.map((i) => i.community_id).filter((id): id is string => Boolean(id)))];
  const threadIds    = all.filter((i) => i._type === "thread").map((i) => i.id);
  const eventIds     = all.filter((i) => i._type === "event").map((i) => i.id);
  const resourceIds  = all.filter((i) => i._type === "resource").map((i) => i.id);

  timer.checkpoint("feed_queries");

  const enrichmentResults = await Promise.all([
    timer.measure("users_query", async () =>
      await db.from("users").select("id, name").in("id", userIds),
    ),
    timer.measure("profiles_query", async () =>
      await db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
    ),
    timer.measure("communities_query", async () =>
      await db.from("communities").select("id, name, image_url").in("id", communityIds),
    ),
    timer.measure("interactions_query", async () =>
      await db.rpc("get_home_feed_interactions", {
        p_user_id: userId,
        p_thread_ids: threadIds,
        p_event_ids: eventIds,
        p_resource_ids: resourceIds,
      }),
    ),
  ]);

  // Enrichment is supplementary: comment/vote/save counts, author avatars, and
  // the current user's vote/save state. The primary posts already loaded
  // successfully above, so a failure in any single enrichment query must NOT
  // blank out the entire home feed. Log the specific failing query for
  // diagnosis and fall back to empty data, so its aggregate defaults to 0 /
  // false while the rest of the feed renders normally.
  const enrichmentLabels = [
    "users",
    "designer_profiles",
    "communities",
    "home_feed_interactions",
  ] as const;

  enrichmentResults.forEach((result, index) => {
    if (result && "error" in result && result.error) {
      console.error(
        `[GET home feed enrichment] "${enrichmentLabels[index]}" query failed:`,
        result.error,
      );
    }
  });

  const [
    { data: users },
    { data: profiles },
    { data: communities },
    { data: interactionData },
  ] = enrichmentResults;
  timer.checkpoint("enrichment");

  const interactions = (interactionData ?? {
    threads: {},
    events: {},
    resources: {},
  }) as InteractionCounts;
  const userMap      = Object.fromEntries(((users ?? []) as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]));
  const avatarMap    = Object.fromEntries(((profiles ?? []) as Array<{ user_id: string; avatar_url: string | null }>).map((p) => [p.user_id, p.avatar_url]));
  const communityMap    = Object.fromEntries(((communities ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const communityImgMap = Object.fromEntries(((communities ?? []) as Array<{ id: string; image_url: string | null }>).map((c) => [c.id, c.image_url ?? null]));

  const items = all.map((item) => {
    const userObj = userMap[item.user_id]
      ? { name: userMap[item.user_id], avatar_url: avatarMap[item.user_id] ?? null }
      : null;

    const base = {
      ...item,
      community_name:  communityMap[item.community_id]    ?? null,
      community_image: communityImgMap[item.community_id] ?? null,
      users: userObj,
    };

    if (item._type === "thread") {
      return {
        ...base,
        attachments: (base as { attachments?: unknown }).attachments ?? [],
        links: (base as { links?: unknown }).links ?? [],
        allow_replies: (base as { allow_replies?: unknown }).allow_replies ?? true,
        updated_at: base.created_at,
        comment_count: interactions.threads[item.id]?.comment_count ?? 0,
        vote_count: interactions.threads[item.id]?.vote_count ?? 0,
        user_voted: interactions.threads[item.id]?.user_voted ?? false,
        user_saved: interactions.threads[item.id]?.user_saved ?? false,
      };
    }
    if (item._type === "event") {
      return {
        ...base,
        end_date: (base as { end_date?: string | null }).end_date ?? null,
        meet_link: (base as { meet_link?: string | null }).meet_link ?? null,
        max_attendees: (base as { max_attendees?: number | null }).max_attendees ?? null,
        updated_at: base.created_at,
        comment_count: interactions.events[item.id]?.comment_count ?? 0,
        rsvp_count: interactions.events[item.id]?.rsvp_count ?? 0,
        user_rsvped: interactions.events[item.id]?.user_rsvped ?? false,
        like_count: interactions.events[item.id]?.like_count ?? 0,
        user_liked: interactions.events[item.id]?.user_liked ?? false,
        save_count: interactions.events[item.id]?.save_count ?? 0,
        user_saved: interactions.events[item.id]?.user_saved ?? false,
      };
    }
    // resource
    return {
      ...base,
      updated_at: base.created_at,
      comment_count: interactions.resources[item.id]?.comment_count ?? 0,
      save_count: interactions.resources[item.id]?.save_count ?? 0,
      user_saved: interactions.resources[item.id]?.user_saved ?? false,
      bookmark_count: interactions.resources[item.id]?.bookmark_count ?? 0,
      user_bookmarked: interactions.resources[item.id]?.user_bookmarked ?? false,
    };
  });

  timer.checkpoint("serialization");
  timer.finish({
    query_count: 7,
    candidate_rows: (threads?.length ?? 0) + (events?.length ?? 0) + (resources?.length ?? 0),
    returned_rows: items.length,
    author_ids: userIds.length,
    community_ids: communityIds.length,
    interaction_ids: threadIds.length + eventIds.length + resourceIds.length,
  });

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
