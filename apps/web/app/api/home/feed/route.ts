import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const PAGE_SIZE = 30;

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
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

  const [{ data: threads }, { data: events }, { data: resources }] = await Promise.all([
    threadsQ, eventsQ, resourcesQ,
  ]);

  // Merge and sort newest-first, take top PAGE_SIZE
  const all = [
    ...(threads   ?? []).map((t) => ({ ...t, _type: "thread"   as const })),
    ...(events    ?? []).map((e) => ({ ...e, _type: "event"    as const })),
    ...(resources ?? []).map((r) => ({ ...r, _type: "resource" as const })),
  ]
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
    .slice(0, PAGE_SIZE);

  if (!all.length) return NextResponse.json({ items: [] });

  // Collect IDs for batch enrichment
  const userIds      = [...new Set(all.map((i) => i.user_id))];
  const communityIds = [...new Set(all.map((i) => i.community_id))];
  const threadIds    = all.filter((i) => i._type === "thread").map((i) => i.id);
  const eventIds     = all.filter((i) => i._type === "event").map((i) => i.id);
  const resourceIds  = all.filter((i) => i._type === "resource").map((i) => i.id);

  const [
    { data: users },
    { data: profiles },
    { data: communities },
    // threads
    { data: threadComments },
    { data: threadVotes },
    { data: myThreadVotes },
    { data: myThreadSaves },
    // events
    { data: eventRsvps },
    { data: myEventRsvps },
    { data: eventSaves },
    { data: myEventSaves },
    { data: eventComments },
    // resources
    { data: resourceSaves },
    { data: myResourceSaves },
    { data: resourceBookmarks },
    { data: myResourceBookmarks },
    { data: resourceComments },
  ] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
    db.from("communities").select("id, name, image_url").in("id", communityIds),
    // threads
    threadIds.length
      ? db.from("thread_comments").select("thread_id").in("thread_id", threadIds)
      : Promise.resolve({ data: [] as { thread_id: string }[] }),
    threadIds.length
      ? db.from("thread_votes").select("thread_id").in("thread_id", threadIds)
      : Promise.resolve({ data: [] as { thread_id: string }[] }),
    threadIds.length
      ? db.from("thread_votes").select("thread_id").in("thread_id", threadIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { thread_id: string }[] }),
    threadIds.length
      ? db.from("thread_saves").select("thread_id").in("thread_id", threadIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { thread_id: string }[] }),
    // events
    eventIds.length
      ? db.from("event_rsvps").select("event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    eventIds.length
      ? db.from("event_rsvps").select("event_id").in("event_id", eventIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    eventIds.length
      ? db.from("event_saves").select("event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    eventIds.length
      ? db.from("event_saves").select("event_id").in("event_id", eventIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    eventIds.length
      ? db.from("event_comments").select("event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    // resources
    resourceIds.length
      ? db.from("resource_saves").select("resource_id").in("resource_id", resourceIds)
      : Promise.resolve({ data: [] as { resource_id: string }[] }),
    resourceIds.length
      ? db.from("resource_saves").select("resource_id").in("resource_id", resourceIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { resource_id: string }[] }),
    resourceIds.length
      ? db.from("resource_bookmarks").select("resource_id").in("resource_id", resourceIds)
      : Promise.resolve({ data: [] as { resource_id: string }[] }),
    resourceIds.length
      ? db.from("resource_bookmarks").select("resource_id").in("resource_id", resourceIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { resource_id: string }[] }),
    resourceIds.length
      ? db.from("resource_comments").select("resource_id").in("resource_id", resourceIds)
      : Promise.resolve({ data: [] as { resource_id: string }[] }),
  ]);

  const userMap      = Object.fromEntries((users      ?? []).map((u) => [u.id,      u.name]));
  const avatarMap    = Object.fromEntries((profiles   ?? []).map((p) => [p.user_id, p.avatar_url]));
  const communityMap    = Object.fromEntries((communities ?? []).map((c) => [c.id, c.name]));
  const communityImgMap = Object.fromEntries((communities ?? []).map((c) => [c.id, (c as { image_url?: string | null }).image_url ?? null]));

  // Thread aggregates
  const threadCmtCount: Record<string, number> = {};
  for (const c of (threadComments ?? [])) threadCmtCount[c.thread_id] = (threadCmtCount[c.thread_id] ?? 0) + 1;
  const voteCount: Record<string, number> = {};
  for (const v of (threadVotes ?? [])) voteCount[v.thread_id] = (voteCount[v.thread_id] ?? 0) + 1;
  const myVoteSet  = new Set((myThreadVotes  ?? []).map((v) => v.thread_id));
  const mySaveSet  = new Set((myThreadSaves  ?? []).map((s) => s.thread_id));

  // Event aggregates
  const eventRsvpCount: Record<string, number> = {};
  for (const r of (eventRsvps ?? [])) eventRsvpCount[r.event_id] = (eventRsvpCount[r.event_id] ?? 0) + 1;
  const eventSaveCount: Record<string, number> = {};
  for (const s of (eventSaves ?? [])) eventSaveCount[s.event_id] = (eventSaveCount[s.event_id] ?? 0) + 1;
  const eventCmtCount: Record<string, number> = {};
  for (const c of (eventComments ?? [])) eventCmtCount[c.event_id] = (eventCmtCount[c.event_id] ?? 0) + 1;
  const myEventRsvpSet = new Set((myEventRsvps ?? []).map((r) => r.event_id));
  const myEventSaveSet = new Set((myEventSaves ?? []).map((s) => s.event_id));

  // Resource aggregates
  const resSaveCount: Record<string, number> = {};
  for (const s of (resourceSaves ?? [])) resSaveCount[s.resource_id] = (resSaveCount[s.resource_id] ?? 0) + 1;
  const resBookmarkCount: Record<string, number> = {};
  for (const b of (resourceBookmarks ?? [])) resBookmarkCount[b.resource_id] = (resBookmarkCount[b.resource_id] ?? 0) + 1;
  const resCmtCount: Record<string, number> = {};
  for (const c of (resourceComments ?? [])) resCmtCount[c.resource_id] = (resCmtCount[c.resource_id] ?? 0) + 1;
  const myResSaveSet     = new Set((myResourceSaves     ?? []).map((s) => s.resource_id));
  const myResBookmarkSet = new Set((myResourceBookmarks ?? []).map((b) => b.resource_id));

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
        comment_count: threadCmtCount[item.id] ?? 0,
        vote_count: voteCount[item.id] ?? 0,
        user_voted: myVoteSet.has(item.id),
        user_saved: mySaveSet.has(item.id),
      };
    }
    if (item._type === "event") {
      return {
        ...base,
        end_date: (base as { end_date?: string | null }).end_date ?? null,
        meet_link: (base as { meet_link?: string | null }).meet_link ?? null,
        max_attendees: (base as { max_attendees?: number | null }).max_attendees ?? null,
        updated_at: base.created_at,
        comment_count: eventCmtCount[item.id] ?? 0,
        rsvp_count: eventRsvpCount[item.id] ?? 0,
        user_rsvped: myEventRsvpSet.has(item.id),
        save_count: eventSaveCount[item.id] ?? 0,
        user_saved: myEventSaveSet.has(item.id),
      };
    }
    // resource
    return {
      ...base,
      updated_at: base.created_at,
      comment_count: resCmtCount[item.id] ?? 0,
      save_count: resSaveCount[item.id] ?? 0,
      user_saved: myResSaveSet.has(item.id),
      bookmark_count: resBookmarkCount[item.id] ?? 0,
      user_bookmarked: myResBookmarkSet.has(item.id),
    };
  });

  return NextResponse.json({ items });
}
