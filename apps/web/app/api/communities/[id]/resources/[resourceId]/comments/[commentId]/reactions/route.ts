import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import {
  attachCommentReactions,
  isCommentReaction,
  toggleCommentReaction,
  type CommentReactionSummary,
} from "@/lib/communities/comment-reactions";

/** Emoji reactions on resource comments — the same contract as the thread route. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId, commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  const limit = await rateLimit(`comment-reaction:resource:${userId}:60s`, 60, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many reactions. Please slow down." }, { status: 429 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!isCommentReaction(payload.emoji)) {
    return NextResponse.json({ error: "Unsupported reaction." }, { status: 422 });
  }
  const emoji = payload.emoji;

  // The comment must belong to this resource.
  const { data: comment } = await db
    .from("resource_comments")
    .select("id, resource_id")
    .eq("id", commentId)
    .eq("resource_id", resourceId)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // Resource-level access: same rules as reading its comments.
  let resourceQuery = db.from("community_resources").select("is_public").eq("id", resourceId);
  resourceQuery = publicScope
    ? resourceQuery.eq("is_public", true).is("community_id", null)
    : resourceQuery.eq("community_id", communityId);
  const { data: resourceAccess } = await resourceQuery.maybeSingle();
  if (!resourceAccess) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  if (!resourceAccess.is_public && !publicScope) {
    const { data: membership } = await db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
    }
  }

  try {
    await toggleCommentReaction({ db, commentId, userId, emoji, kind: "resources" });
  } catch (error) {
    console.error("[resource comment reaction]", error);
    return NextResponse.json(
      { error: "Reactions are not available yet. Apply the latest database migration." },
      { status: 503 },
    );
  }

  // Authoritative grouped state for this comment.
  const [enriched] = await attachCommentReactions(db, [{ id: commentId }], userId, "resources");
  const reactions = (enriched as { reactions?: CommentReactionSummary[] }).reactions ?? [];

  void publishRealtimeBatch([
    { room: realtimeRooms.resourceComments(resourceId), topic: "comment", data: { user_id: userId, reaction: true } },
  ]);

  return NextResponse.json({ reactions });
}
