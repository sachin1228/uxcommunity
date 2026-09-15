import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { attachAuthors, communityOf } from "@/lib/profile-content";

export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const db = createServiceClient();

  const { data, error } = await db
    .from("community_threads")
    .select(
      "id, community_id, user_id, title, category, tags, attachments, links, allow_replies, poll, created_at, updated_at, communities(id, name, image_url)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET profile threads]", error);
    return NextResponse.json({ error: "Failed to fetch your threads." }, { status: 500 });
  }

  const threads = (data ?? []).map((thread) => ({
    ...(thread as Record<string, unknown>),
    community: communityOf((thread as { communities?: unknown }).communities),
    communities: undefined,
  }));

  const threadsWithVotes = await attachPollVotes(
    db,
    threads as unknown as Array<Record<string, unknown>>,
    userId,
  );
  if (!threadsWithVotes.length) return NextResponse.json({ threads: [] });

  const [authoredThreads, { data: allLikes }, { data: myLikes }, { data: mySaves }, { data: allComments }] =
    await Promise.all([
      attachAuthors(db, threadsWithVotes),
      db.from("thread_likes").select("thread_id").in("thread_id", threadsWithVotes.map((t) => t.id as string)),
      db.from("thread_likes").select("thread_id").in("thread_id", threadsWithVotes.map((t) => t.id as string)).eq("user_id", userId),
      db.from("thread_saves").select("thread_id").in("thread_id", threadsWithVotes.map((t) => t.id as string)).eq("user_id", userId),
      db.from("thread_comments").select("thread_id").in("thread_id", threadsWithVotes.map((t) => t.id as string)),
    ]);

  const likeCountMap: Record<string, number> = {};
  for (const l of allLikes ?? []) likeCountMap[l.thread_id] = (likeCountMap[l.thread_id] ?? 0) + 1;

  const commentCountMap: Record<string, number> = {};
  for (const c of allComments ?? []) commentCountMap[c.thread_id] = (commentCountMap[c.thread_id] ?? 0) + 1;

  const myLikeSet = new Set((myLikes ?? []).map((l) => l.thread_id));
  const mySaveSet = new Set((mySaves ?? []).map((s) => s.thread_id));

  return NextResponse.json({
    threads: authoredThreads.map((thread) => ({
      ...thread,
      like_count: likeCountMap[thread.id as string] ?? 0,
      user_liked: myLikeSet.has(thread.id as string),
      user_saved: mySaveSet.has(thread.id as string),
      comment_count: commentCountMap[thread.id as string] ?? 0,
    })),
  });
}
