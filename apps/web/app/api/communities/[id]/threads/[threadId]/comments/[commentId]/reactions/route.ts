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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, threadId, commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  const limit = await rateLimit(`comment-reaction:${userId}:60s`, 60, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many reactions. Please slow down." }, { status: 429 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!isCommentReaction(payload.emoji)) {
    return NextResponse.json({ error: "Unsupported reaction." }, { status: 422 });
  }
  const emoji = payload.emoji;

  // The comment must belong to this thread.
  const { data: comment } = await db
    .from("thread_comments")
    .select("id, user_id")
    .eq("id", commentId)
    .eq("thread_id", threadId)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // Thread-level access: same rules as reading comments.
  let threadQuery = db.from("community_threads").select("is_public").eq("id", threadId);
  threadQuery = publicScope
    ? threadQuery.eq("is_public", true).is("community_id", null)
    : threadQuery.eq("community_id", communityId);
  const { data: threadAccess } = await threadQuery.maybeSingle();
  if (!threadAccess) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  if (!threadAccess.is_public && !publicScope && !(await (async () => {
    const { data: membership } = await db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(membership);
  })())) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  try {
    await toggleCommentReaction({ db, commentId, userId, emoji });
  } catch (error) {
    console.error("[comment reaction]", error);
    return NextResponse.json(
      { error: "Reactions are not available yet. Apply the latest database migration." },
      { status: 503 },
    );
  }

  // Authoritative grouped state for this comment.
  const [enriched] = await attachCommentReactions(db, [{ id: commentId }], userId);
  const reactions = (enriched as { reactions?: CommentReactionSummary[] }).reactions ?? [];

  void publishRealtimeBatch([
    { room: realtimeRooms.threadComments(threadId), topic: "comment", data: { user_id: userId, reaction: true } },
  ]);

  return NextResponse.json({ reactions });
}
