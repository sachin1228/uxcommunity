import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { isCommunityMember } from "@/lib/communities/membership";
import { rateLimit } from "@/lib/auth/rate-limit";
import { deferNotification, resourceHref } from "@/lib/notifications";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { attachCommentAuthors } from "@/lib/communities/comment-authors";
import type { CommentAuthor } from "@/lib/communities/comment-authors";
import { attachCommentReactions } from "@/lib/communities/comment-reactions";
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
  // array they read.
  return (await attachCommentAuthors(db, rows)).map((row) => ({
    ...row,
    replies: (Array.isArray(row.replies) ? row.replies : []) as EnrichedRow[],
  }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  // Allow any authenticated user to read comments on public resources
  let accessQuery = db
    .from("community_resources")
    .select("is_public")
    .eq("id", resourceId)
  accessQuery = publicScope
    ? accessQuery.eq("is_public", true).is("community_id", null)
    : accessQuery.eq("community_id", communityId);
  const { data: resourceAccess } = await accessQuery.maybeSingle();

  if (!resourceAccess) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  if (!resourceAccess.is_public && !publicScope && !(await isCommunityMember(communityId, session.userId!, db))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  // One page, not the whole discussion: the newest page by default, or the page
  // above the caller's cursor (see lib/communities/comment-pages.ts).
  const page = await loadCommentPage(db, "resources", resourceId, parseCommentPageRequest(req.nextUrl.searchParams));
  if (page.error) {
    console.error("[GET resource comments]", page.error);
    return NextResponse.json({ error: "Failed to fetch comments." }, { status: 500 });
  }

  // Authors and reactions are attached while the page is still a FLAT list —
  // both look rows up by id, so an already-nested reply would be skipped — and
  // then the list is nested for the section.
  const withUsers = await attachUsers(db, page.rows as Array<Record<string, unknown>>);
  const withReactions = await attachCommentReactions(db, withUsers, session.userId!, "resources");

  return NextResponse.json({
    comments: nestCommentRows(withReactions),
    totalCount: page.totalCount,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  // Fetch resource to check access in one query
  let resourceQuery = db
    .from("community_resources")
    .select("id, user_id, title, is_public, allow_replies")
    .eq("id", resourceId)
  resourceQuery = publicScope
    ? resourceQuery.eq("is_public", true).is("community_id", null)
    : resourceQuery.eq("community_id", communityId);
  const { data: resource } = await resourceQuery.maybeSingle();
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  // Private resources require community membership to comment
  if (!resource.is_public && !publicScope && !(await isCommunityMember(communityId, userId, db))) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  if (resource.allow_replies === false) {
    return NextResponse.json({ error: "Comments are turned off for this resource." }, { status: 403 });
  }

  const limit = await rateLimit(`resource-comment:create:${userId}:60s`, 20, 60);
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
      .from("resource_comments")
      .select("id, parent_id, user_id")
      .eq("id", parentId)
      .eq("resource_id", resourceId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: "Parent comment not found." }, { status: 404 });
    if (parent.parent_id) return NextResponse.json({ error: "Cannot reply to a reply." }, { status: 422 });
    parentAuthorId = parent.user_id;
  }

  const { data: inserted, error } = await db
    .from("resource_comments")
    .insert({ resource_id: resourceId, user_id: userId, parent_id: parentId, body: text })
    .select("id, resource_id, user_id, parent_id, body, created_at, updated_at")
    .single();

  if (error || !inserted) {
    console.error("[POST resource comment]", error);
    return NextResponse.json({ error: "Failed to post comment." }, { status: 500 });
  }

  const href = resourceHref(communityId, resourceId);
  void publishRealtimeBatch([
    { room: realtimeRooms.resourceComments(resourceId), topic: "comment", data: { user_id: userId } },
  ]);
  // The chat timeline's "created a resource" card shows this resource's comment
  // count — broadcast the new total so open chats update without a reload.
  void publishContentCommentCount(db, communityId, resourceId, "resource");
  deferNotification({
    userId: resource.user_id,
    actorId: userId,
    communityId,
    type: "resource_comment",
    entityType: "resource",
    entityId: resourceId,
    title: (actorName) => `${actorName} commented on your resource`,
    body: resource.title,
    href,
  });

  if (parentAuthorId && parentAuthorId !== resource.user_id) {
    deferNotification({
      userId: parentAuthorId,
      actorId: userId,
      communityId,
      type: "resource_reply",
      entityType: "resource",
      entityId: resourceId,
      title: (actorName) => `${actorName} replied to your comment`,
      body: resource.title,
      href,
    });
  }

  const [enriched] = await attachCommentReactions(
    db,
    await attachUsers(db, [inserted as Record<string, unknown>]),
    userId,
    "resources",
  );
  return NextResponse.json({ comment: enriched }, { status: 201 });
}
