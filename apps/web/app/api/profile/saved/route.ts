import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { requireSession } from "@/lib/auth/session";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { attachAuthors, communityOf } from "@/lib/profile-content";

export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId!;
  const db = createServiceClient();

  // Fetch all three save lists in parallel
  const [
    { data: threadSaveRows },
    { data: rsvpRows },
    { data: bookmarkRows },
  ] = await Promise.all([
    db.from("thread_saves").select("thread_id").eq("user_id", userId),
    db.from("event_saves").select("event_id").eq("user_id", userId),
    db.from("resource_bookmarks").select("resource_id").eq("user_id", userId),
  ]);

  const threadIds   = (threadSaveRows ?? []).map((r) => r.thread_id);
  const eventIds    = (rsvpRows ?? []).map((r) => r.event_id);
  const resourceIds = (bookmarkRows ?? []).map((r) => r.resource_id);

  // Fetch the actual records (skip if empty)
  const [
    { data: rawThreads },
    { data: rawEvents },
    { data: rawResources },
  ] = await Promise.all([
    threadIds.length
      ? db
          .from("community_threads")
          .select("id, community_id, user_id, title, category, tags, attachments, links, allow_replies, poll, created_at, updated_at, communities(id, name, image_url)")
          .in("id", threadIds)
          .order("created_at", { ascending: false })
      : { data: [] },
    eventIds.length
      ? db
          .from("community_events")
          .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, accent_color, created_at, updated_at, communities(id, name, image_url)")
          .in("id", eventIds)
          .order("event_date", { ascending: false })
      : { data: [] },
    resourceIds.length
      ? db
          .from("community_resources")
          .select("id, community_id, user_id, title, description, resource_type, url, allow_replies, created_at, updated_at, communities(id, name, image_url)")
          .in("id", resourceIds)
          .order("created_at", { ascending: false })
      : { data: [] },
  ]);

  // ── Enrich threads ───────────────────────────────────────────────────────
  const threads = (rawThreads ?? []).map((t) => ({
    ...(t as Record<string, unknown>),
    community: communityOf((t as { communities?: unknown }).communities),
    communities: undefined,
  }));
  const threadRows = await attachPollVotes(
    db,
    threads as unknown as Array<Record<string, unknown>>,
    userId,
  );

  let enrichedThreads: unknown[] = threadRows;
  if (threadRows.length) {
    const ids = threadRows.map((t) => t.id as string);
    const [authoredRows, { data: allLikes }, { data: myLikes }, { data: mySaves }, { data: allComments }] =
      await Promise.all([
        attachAuthors(db, threadRows),
        db.from("thread_likes").select("thread_id").in("thread_id", ids),
        db.from("thread_likes").select("thread_id").in("thread_id", ids).eq("user_id", userId),
        db.from("thread_saves").select("thread_id").in("thread_id", ids).eq("user_id", userId),
        db.from("thread_comments").select("thread_id").in("thread_id", ids),
      ]);

    const likeCountMap: Record<string, number> = {};
    for (const l of allLikes ?? []) likeCountMap[l.thread_id] = (likeCountMap[l.thread_id] ?? 0) + 1;
    const commentCountMap: Record<string, number> = {};
    for (const c of allComments ?? []) commentCountMap[c.thread_id] = (commentCountMap[c.thread_id] ?? 0) + 1;
    const myLikeSet = new Set((myLikes ?? []).map((l) => l.thread_id));
    const mySaveSet = new Set((mySaves ?? []).map((s) => s.thread_id));

    enrichedThreads = authoredRows.map((t) => ({
      ...t,
      like_count: likeCountMap[t.id as string] ?? 0,
      user_liked: myLikeSet.has(t.id as string),
      user_saved: mySaveSet.has(t.id as string),
      comment_count: commentCountMap[t.id as string] ?? 0,
    }));
  }

  // ── Enrich events ────────────────────────────────────────────────────────
  const events = (rawEvents ?? []).map((e) => ({
    ...(e as Record<string, unknown>),
    community: communityOf((e as { communities?: unknown }).communities),
    communities: undefined,
  }));

  let enrichedEvents: unknown[] = events;
  if (events.length) {
    const ids = (events as Array<Record<string, unknown>>).map((e) => e.id as string);
    const [authoredRows, previewsResult, { data: allRsvps }, { data: myRsvps }, { data: allLikes }, { data: myLikes }, { data: allSaves }, { data: mySaves }] =
      await Promise.all([
        attachAuthors(db, events),
        callPerformanceRpc(db, "get_event_attendee_previews", { p_event_ids: ids, p_limit: 5 }),
        db.from("event_rsvps").select("event_id").in("event_id", ids),
        db.from("event_rsvps").select("event_id").in("event_id", ids).eq("user_id", userId),
        db.from("event_likes").select("event_id").in("event_id", ids),
        db.from("event_likes").select("event_id").in("event_id", ids).eq("user_id", userId),
        db.from("event_saves").select("event_id").in("event_id", ids),
        db.from("event_saves").select("event_id").in("event_id", ids).eq("user_id", userId),
      ]);
    const countByEvent = (rows: Array<{ event_id: string }> | null) => (rows ?? []).reduce<Record<string, number>>((counts, row) => {
      counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
      return counts;
    }, {});
    const rsvpCounts = countByEvent(allRsvps);
    const likeCounts = countByEvent(allLikes);
    const saveCounts = countByEvent(allSaves);
    const myRsvpSet = new Set((myRsvps ?? []).map((r) => r.event_id));
    const myLikeSet = new Set((myLikes ?? []).map((r) => r.event_id));
    const mySaveSet = new Set((mySaves ?? []).map((r) => r.event_id));
    if (previewsResult.error) {
      console.error("[GET profile saved] attendee previews", previewsResult.error);
    }
    const previewMap = new Map(
      (previewsResult.data ?? []).map((preview) => [preview.id, preview.rsvps]),
    );
    enrichedEvents = authoredRows.map((e) => ({
      ...e,
      rsvp_count: rsvpCounts[e.id as string] ?? 0,
      user_rsvped: myRsvpSet.has(e.id as string),
      like_count: likeCounts[e.id as string] ?? 0,
      user_liked: myLikeSet.has(e.id as string),
      save_count: saveCounts[e.id as string] ?? 0,
      user_saved: mySaveSet.has(e.id as string),
      rsvps: previewMap.get(e.id as string) ?? [],
    }));
  }

  // ── Enrich resources ─────────────────────────────────────────────────────
  const resources = (rawResources ?? []).map((r) => ({
    ...(r as Record<string, unknown>),
    community: communityOf((r as { communities?: unknown }).communities),
    communities: undefined,
  }));

  let enrichedResources: unknown[] = resources;
  if (resources.length) {
    const ids = (resources as Array<Record<string, unknown>>).map((r) => r.id as string);
    const [authoredRows, { data: allSaves }, { data: mySaves }, { data: allBookmarks }, { data: myBm }, { data: allComments }] =
      await Promise.all([
        attachAuthors(db, resources),
        db.from("resource_saves").select("resource_id").in("resource_id", ids),
        db.from("resource_saves").select("resource_id").in("resource_id", ids).eq("user_id", userId),
        db.from("resource_bookmarks").select("resource_id").in("resource_id", ids),
        db.from("resource_bookmarks").select("resource_id").in("resource_id", ids).eq("user_id", userId),
        db.from("resource_comments").select("resource_id").in("resource_id", ids),
      ]);

    const saveCountMap: Record<string, number> = {};
    for (const s of allSaves ?? []) saveCountMap[s.resource_id] = (saveCountMap[s.resource_id] ?? 0) + 1;
    const bookmarkCountMap: Record<string, number> = {};
    for (const b of allBookmarks ?? []) bookmarkCountMap[b.resource_id] = (bookmarkCountMap[b.resource_id] ?? 0) + 1;
    const commentCountMap: Record<string, number> = {};
    for (const c of allComments ?? []) commentCountMap[c.resource_id] = (commentCountMap[c.resource_id] ?? 0) + 1;
    const mySaveSet = new Set((mySaves ?? []).map((s) => s.resource_id));
    const myBmSet = new Set((myBm ?? []).map((b) => b.resource_id));

    enrichedResources = authoredRows.map((r) => ({
      ...r,
      save_count: saveCountMap[r.id as string] ?? 0,
      user_saved: mySaveSet.has(r.id as string),
      comment_count: commentCountMap[r.id as string] ?? 0,
      bookmark_count: bookmarkCountMap[r.id as string] ?? 0,
      user_bookmarked: myBmSet.has(r.id as string),
    }));
  }

  return NextResponse.json({
    threads: enrichedThreads,
    events: enrichedEvents,
    resources: enrichedResources,
  });
}

