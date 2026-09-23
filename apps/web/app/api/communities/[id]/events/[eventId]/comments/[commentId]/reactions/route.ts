import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { isPublicContentScope } from "@/lib/content-scope";
import {
  attachCommentReactions,
  isCommentReaction,
  toggleCommentReaction,
  type CommentReactionSummary,
} from "@/lib/communities/comment-reactions";

/**
 * Emoji reactions on event comments — the same contract as the thread route.
 *
 * Event comments have no realtime room (the discussion loads through the
 * request cache), so this returns the authoritative grouped state and lets the
 * caller patch it in, like the event comment POST does.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string; commentId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, eventId, commentId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();
  const publicScope = isPublicContentScope(communityId);

  const limit = await rateLimit(`comment-reaction:event:${userId}:60s`, 60, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many reactions. Please slow down." }, { status: 429 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!isCommentReaction(payload.emoji)) {
    return NextResponse.json({ error: "Unsupported reaction." }, { status: 422 });
  }
  const emoji = payload.emoji;

  // The comment must belong to this event.
  const { data: comment } = await db
    .from("event_comments")
    .select("id, event_id")
    .eq("id", commentId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  // Event-level access: same rules as reading its comments.
  let eventQuery = db.from("community_events").select("id").eq("id", eventId);
  eventQuery = publicScope
    ? eventQuery.eq("is_public", true).is("community_id", null)
    : eventQuery.eq("community_id", communityId);
  const { data: event } = await eventQuery.maybeSingle();
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  try {
    await toggleCommentReaction({ db, commentId, userId, emoji, kind: "events" });
  } catch (error) {
    console.error("[event comment reaction]", error);
    return NextResponse.json(
      { error: "Reactions are not available yet. Apply the latest database migration." },
      { status: 503 },
    );
  }

  // Authoritative grouped state for this comment.
  const [enriched] = await attachCommentReactions(db, [{ id: commentId }], userId, "events");
  const reactions = (enriched as { reactions?: CommentReactionSummary[] }).reactions ?? [];

  return NextResponse.json({ reactions });
}
