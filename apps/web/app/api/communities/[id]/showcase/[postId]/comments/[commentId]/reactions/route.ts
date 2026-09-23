import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import {
  attachCommentReactions,
  isCommentReaction,
  toggleCommentReaction,
  type CommentReactionSummary,
} from "@/lib/communities/comment-reactions";

/** Emoji reactions on showcase comments — the same contract as the thread route. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, postId, commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const limit = await rateLimit(`comment-reaction:showcase:${userId}:60s`, 60, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many reactions. Please slow down." }, { status: 429 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!isCommentReaction(payload.emoji)) {
    return NextResponse.json({ error: "Unsupported reaction." }, { status: 422 });
  }
  const emoji = payload.emoji;

  // The comment must belong to this showcase post.
  const { data: comment } = await db
    .from("showcase_comments")
    .select("id, post_id")
    .eq("id", commentId)
    .eq("post_id", postId)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // Post-level access: members, or anyone on a publicly published post.
  const [membership, { data: post }] = await Promise.all([
    db.from("community_members").select("joined_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("community_showcase_posts").select("id, is_public").eq("id", postId).eq("community_id", communityId).maybeSingle(),
  ]);
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  if (!membership && post.is_public !== true) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  try {
    await toggleCommentReaction({ db, commentId, userId, emoji, kind: "showcase" });
  } catch (error) {
    console.error("[showcase comment reaction]", error);
    return NextResponse.json(
      { error: "Reactions are not available yet. Apply the latest database migration." },
      { status: 503 },
    );
  }

  // Authoritative grouped state for this comment.
  const [enriched] = await attachCommentReactions(db, [{ id: commentId }], userId, "showcase");
  const reactions = (enriched as { reactions?: CommentReactionSummary[] }).reactions ?? [];

  void publishRealtimeBatch([
    { room: realtimeRooms.showcase(postId), topic: "comment", data: { user_id: userId, reaction: true } },
  ]);

  return NextResponse.json({ reactions });
}
