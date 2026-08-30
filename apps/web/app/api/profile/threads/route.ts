import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

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
      "id, community_id, user_id, title, category, tags, attachments, links, allow_replies, created_at, updated_at, communities(name)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET profile threads]", error);
    return NextResponse.json({ error: "Failed to fetch your threads." }, { status: 500 });
  }

  const threads = (data ?? []).map((thread) => {
    const raw = (thread as { communities?: unknown }).communities;
    const community: { name: string } | null =
      !raw ? null : Array.isArray(raw) ? ((raw[0] as { name: string }) ?? null) : (raw as { name: string });
    return { ...thread, users: null, community, communities: undefined };
  });

  if (!threads.length) return NextResponse.json({ threads: [] });

  const threadIds = threads.map((t) => t.id);
  const [{ data: allLikes }, { data: myLikes }, { data: mySaves }, { data: allComments }] = await Promise.all([
    db.from("thread_likes").select("thread_id").in("thread_id", threadIds),
    db.from("thread_likes").select("thread_id").in("thread_id", threadIds).eq("user_id", userId),
    db.from("thread_saves").select("thread_id").in("thread_id", threadIds).eq("user_id", userId),
    db.from("thread_comments").select("thread_id").in("thread_id", threadIds),
  ]);

  const likeCountMap: Record<string, number> = {};
  for (const l of allLikes ?? []) likeCountMap[l.thread_id] = (likeCountMap[l.thread_id] ?? 0) + 1;

  const commentCountMap: Record<string, number> = {};
  for (const c of allComments ?? []) commentCountMap[c.thread_id] = (commentCountMap[c.thread_id] ?? 0) + 1;

  const myLikeSet = new Set((myLikes ?? []).map((l) => l.thread_id));
  const mySaveSet = new Set((mySaves ?? []).map((s) => s.thread_id));

  return NextResponse.json({
    threads: threads.map((thread) => ({
      ...thread,
      like_count: likeCountMap[thread.id] ?? 0,
      user_liked: myLikeSet.has(thread.id),
      user_saved: mySaveSet.has(thread.id),
      comment_count: commentCountMap[thread.id] ?? 0,
    })),
  });
}
