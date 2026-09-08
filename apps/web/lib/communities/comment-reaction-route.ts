import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { isPublicContentScope } from "@/lib/content-scope";
import { publishRealtimeBatch } from "@/lib/realtime/publish";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isCommentReaction,
  toggleCommentReaction,
  type CommentReactionColumn,
} from "./comment-reactions";

interface ReactionRouteConfig {
  commentTable: "thread_comments" | "resource_comments" | "showcase_comments" | "event_comments";
  commentTargetColumn: "thread_id" | "resource_id" | "post_id" | "event_id";
  reactionColumn: CommentReactionColumn;
  parentTable: "community_threads" | "community_resources" | "community_showcase_posts" | "community_events";
  room: (targetId: string) => string;
}

export async function handleCommentReaction(
  request: NextRequest,
  { communityId, targetId, commentId }: { communityId: string; targetId: string; commentId: string },
  config: ReactionRouteConfig,
) {
  let session;
  try { session = await requireSession("user"); } catch (error) { return error as Response; }
  const userId = session.userId!;
  const limit = await rateLimit(`comment-reaction:${userId}:60s`, 60, 60);
  if (!limit.success) return NextResponse.json({ error: "Too many reactions. Please slow down." }, { status: 429 });

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!isCommentReaction(payload.emoji)) return NextResponse.json({ error: "Unsupported reaction." }, { status: 422 });

  const db = createServiceClient();
  const { data: comment } = await db
    .from(config.commentTable)
    .select(`id, ${config.commentTargetColumn}`)
    .eq("id", commentId)
    .eq(config.commentTargetColumn, targetId)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  let parentQuery = db.from(config.parentTable).select("id, community_id, is_public").eq("id", targetId);
  parentQuery = isPublicContentScope(communityId)
    ? parentQuery.eq("is_public", true).is("community_id", null)
    : parentQuery.eq("community_id", communityId);
  const { data: parent } = await parentQuery.maybeSingle();
  if (!parent) return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  const scopedParent = parent as { is_public: boolean; community_id: string | null };
  if (!scopedParent.is_public && !isPublicContentScope(communityId)) {
    const { data: membership } = await db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  try {
    const reacted = await toggleCommentReaction({
      db,
      column: config.reactionColumn,
      commentId,
      userId,
      emoji: payload.emoji,
    });
    void publishRealtimeBatch([{ room: config.room(targetId), topic: "comment", data: { user_id: userId, reaction: true } }]);
    return NextResponse.json({ reacted, emoji: payload.emoji });
  } catch (error) {
    console.error("[comment reaction]", error);
    return NextResponse.json({ error: "Comment reactions are not available yet. Apply the latest database migration." }, { status: 503 });
  }
}
