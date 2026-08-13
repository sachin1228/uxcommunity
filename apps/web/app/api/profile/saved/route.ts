import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

function communityOf(raw: unknown): { name: string } | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return (raw[0] as { name: string }) ?? null;
  return raw as { name: string };
}

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
    { data: profile },
  ] = await Promise.all([
    db.from("thread_saves").select("thread_id").eq("user_id", userId),
    db.from("event_rsvps").select("event_id").eq("user_id", userId),
    db.from("resource_bookmarks").select("resource_id").eq("user_id", userId),
    db.from("designer_profiles").select("avatar_url").eq("user_id", userId).maybeSingle(),
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
          .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, created_at, updated_at, communities(name)")
          .in("id", threadIds)
          .order("created_at", { ascending: false })
      : { data: [] },
    eventIds.length
      ? db
          .from("community_events")
          .select("id, community_id, user_id, title, description, event_date, end_date, is_online, location, meet_link, max_attendees, cover_image_url, created_at, updated_at, communities(name)")
          .in("id", eventIds)
          .order("event_date", { ascending: false })
      : { data: [] },
    resourceIds.length
      ? db
          .from("community_resources")
          .select("id, community_id, user_id, title, description, resource_type, url, tags, created_at, updated_at, communities(name)")
          .in("id", resourceIds)
          .order("created_at", { ascending: false })
      : { data: [] },
  ]);

  // ── Enrich threads ───────────────────────────────────────────────────────
  const threads = (rawThreads ?? []).map((t) => ({
    ...t,
    community: communityOf((t as { communities?: unknown }).communities),
    communities: undefined,
    users: null,
  }));

  let enrichedThreads: unknown[] = threads;
  if (threads.length) {
    const ids = threads.map((t) => t.id);
    const [{ data: allVotes }, { data: myVotes }, { data: mySaves }, { data: allComments }] =
      await Promise.all([
        db.from("thread_votes").select("thread_id").in("thread_id", ids),
        db.from("thread_votes").select("thread_id").in("thread_id", ids).eq("user_id", userId),
        db.from("thread_saves").select("thread_id").in("thread_id", ids).eq("user_id", userId),
        db.from("thread_comments").select("thread_id").in("thread_id", ids),
      ]);

    const voteCountMap: Record<string, number> = {};
    for (const v of allVotes ?? []) voteCountMap[v.thread_id] = (voteCountMap[v.thread_id] ?? 0) + 1;
    const commentCountMap: Record<string, number> = {};
    for (const c of allComments ?? []) commentCountMap[c.thread_id] = (commentCountMap[c.thread_id] ?? 0) + 1;
    const myVoteSet = new Set((myVotes ?? []).map((v) => v.thread_id));
    const mySaveSet = new Set((mySaves ?? []).map((s) => s.thread_id));

    enrichedThreads = threads.map((t) => ({
      ...t,
      vote_count: voteCountMap[t.id] ?? 0,
      user_voted: myVoteSet.has(t.id),
      user_saved: mySaveSet.has(t.id),
      comment_count: commentCountMap[t.id] ?? 0,
    }));
  }

  // ── Enrich events ────────────────────────────────────────────────────────
  const events = (rawEvents ?? []).map((e) => ({
    ...e,
    community: communityOf((e as { communities?: unknown }).communities),
    communities: undefined,
    users: null,
  }));

  let enrichedEvents: unknown[] = events;
  if (events.length) {
    const ids = events.map((e) => e.id);
    const [{ data: allRsvps }, { data: myRsvps }] = await Promise.all([
      db.from("event_rsvps").select("event_id").in("event_id", ids),
      db.from("event_rsvps").select("event_id").in("event_id", ids).eq("user_id", userId),
    ]);
    const rsvpCounts: Record<string, number> = {};
    for (const r of allRsvps ?? []) rsvpCounts[r.event_id] = (rsvpCounts[r.event_id] ?? 0) + 1;
    const myRsvpSet = new Set((myRsvps ?? []).map((r) => r.event_id));
    enrichedEvents = events.map((e) => ({
      ...e,
      rsvp_count: rsvpCounts[e.id] ?? 0,
      user_rsvped: myRsvpSet.has(e.id),
    }));
  }

  // ── Enrich resources ─────────────────────────────────────────────────────
  const resources = (rawResources ?? []).map((r) => ({
    ...r,
    community: communityOf((r as { communities?: unknown }).communities),
    communities: undefined,
    users: null,
  }));

  let enrichedResources: unknown[] = resources;
  if (resources.length) {
    const ids = resources.map((r) => r.id);
    const [
      { data: allSaves },
      { data: mySaves },
      { data: allBookmarks },
      { data: myBm },
      { data: allComments },
    ] = await Promise.all([
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

    enrichedResources = resources.map((r) => ({
      ...r,
      save_count: saveCountMap[r.id] ?? 0,
      user_saved: mySaveSet.has(r.id),
      comment_count: commentCountMap[r.id] ?? 0,
      bookmark_count: bookmarkCountMap[r.id] ?? 0,
      user_bookmarked: myBmSet.has(r.id),
    }));
  }

  return NextResponse.json({
    threads: enrichedThreads,
    events: enrichedEvents,
    resources: enrichedResources,
    avatarUrl: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
  });
}
