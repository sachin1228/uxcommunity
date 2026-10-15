import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isCommunityMember } from "@/lib/communities/membership";
import { rateLimit } from "@/lib/auth/rate-limit";
import { deferNotification, threadHref } from "@/lib/notifications";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { attachCommentReactions } from "@/lib/communities/comment-reactions";
import { attachCommentAuthors } from "@/lib/communities/comment-authors";
import type { CommentAuthor } from "@/lib/communities/comment-authors";
import { publishContentCommentCount } from "@/lib/communities/content-comment-counts";
import { loadCommentPage, nestCommentRows } from "@/lib/communities/comment-pages";
import { parseCommentPageRequest } from "@/lib/communities/comment-page-cursor";

type EnrichedRow = Record<string, unknown> & {
  users: CommentAuthor | null;
  replies: EnrichedRow[];
};

async function attachUsers(
  db: ReturnType<typeof createServiceClient>,
  rows: Array<Record<string, unknown>>,
): Promise<EnrichedRow[]> {
  // `replies` is seeded here so the nesting below and the section both have the
  // array they read; a row that came with one keeps it.
  return (await attachCommentAuthors(db, rows)).map((row) => ({
    ...row,
    replies: (Array.isArray(row.replies) ? row.replies : []) as EnrichedRow[],
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId } = await params;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  // Allow any authenticated user to read comments on public threads
  let accessQuery = db
    .from("community_threads")
    .select("is_public")
    .eq("id", threadId);
  accessQuery = publicScope
    ? accessQuery.eq("is_public", true).is("community_id", null)
    : accessQuery.eq("community_id", communityId);
  const { data: threadAccess } = await accessQuery.maybeSingle();

  if (!threadAccess) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  if (!threadAccess.is_public && !publicScope && !(await isCommunityMember(communityId, session.userId!, db))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  // One page, not the thread: the newest page by default, or the page above the
  // caller's cursor (see lib/communities/comment-pages.ts).
  const page = await loadCommentPage(db, "threads", threadId, parseCommentPageRequest(req.nextUrl.searchParams));
  if (page.error) {
    console.error("[GET comments]", page.error);
    return NextResponse.json({ error: "Failed to fetch comments." }, { status: 500 });
  }

  // Authors and reactions are attached while the page is still a FLAT list —
  // both look rows up by id, so a reply that had already been nested away would
  // be skipped, then the flat list is nested for the section.
  const withUsers = await attachUsers(db, page.rows as Array<Record<string, unknown>>);
  const withReactions = await attachCommentReactions(db, withUsers, session.userId!, "threads");

  return NextResponse.json({
    comments: nestCommentRows(withReactions),
    totalCount: page.totalCount,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  // Fetch thread to check access and allow_replies in one query
  let threadQuery = db
    .from("community_threads")
    .select("id, user_id, title, allow_replies, is_public")
    .eq("id", threadId);
  threadQuery = publicScope
    ? threadQuery.eq("is_public", true).is("community_id", null)
    : threadQuery.eq("community_id", communityId);
  const { data: thread } = await threadQuery.maybeSingle();

  if (!thread) return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  if (!thread.allow_replies) return NextResponse.json({ error: "This thread does not allow replies." }, { status: 403 });

  // Private threads require community membership to comment
  if (!thread.is_public && !publicScope && !(await isCommunityMember(communityId, userId, db))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const limit = await rateLimit(`comment:create:${userId}:60s`, 20, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many comments. Please slow down." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text || text.length > 5000) {
    return NextResponse.json({ error: "Comment must be between 1 and 5000 characters." }, { status: 422 });
  }

  const parentId = typeof body.parent_id === "string" ? body.parent_id : null;
  let parentAuthorId: string | null = null;
  if (parentId) {
    const { data: parent } = await db
      .from("thread_comments")
      .select("id, parent_id, user_id")
      .eq("id", parentId)
      .eq("thread_id", threadId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
    // Only allow one level of nesting
    if (parent.parent_id) return NextResponse.json({ error: "Cannot reply to a reply." }, { status: 422 });
    parentAuthorId = parent.user_id;
  }

  const { data: inserted, error } = await db
    .from("thread_comments")
    .insert({ thread_id: threadId, user_id: userId, parent_id: parentId, body: text })
    .select("id, thread_id, user_id, parent_id, body, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST comment]", error);
    return NextResponse.json({ error: "Failed to post comment." }, { status: 500 });
  }

  void publishRealtimeBatch([
    {
      room: realtimeRooms.threadComments(threadId),
      topic: "comment",
      data: { user_id: userId },
    },
  ]);

  // The chat timeline's permanent "created a thread" card shows this thread's
  // comment count — broadcast the new total so members sitting in the chat
  // see the discussion grow without reloading.
  void publishContentCommentCount(db, communityId, threadId, "thread");

  const href = threadHref(communityId, threadId);
  deferNotification({
    userId: thread.user_id,
    actorId: userId,
    communityId,
    type: "thread_comment",
    entityType: "thread",
    entityId: threadId,
    title: (actorName) => `${actorName} commented on your thread`,
    body: thread.title,
    href,
  });

  if (parentAuthorId && parentAuthorId !== thread.user_id) {
    deferNotification({
      userId: parentAuthorId,
      actorId: userId,
      communityId,
      type: "thread_reply",
      entityType: "thread",
      entityId: threadId,
      title: (actorName) => `${actorName} replied to your comment`,
      body: thread.title,
      href,
    });
  }

  const [enriched] = await attachCommentReactions(
    db,
    await attachUsers(db, [inserted as Record<string, unknown>]),
    userId,
    "threads",
  );
  return NextResponse.json({ comment: enriched }, { status: 201 });
}
