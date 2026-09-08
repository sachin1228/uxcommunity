import { NextRequest } from "next/server";
import { handleCommentReaction } from "@/lib/communities/comment-reaction-route";
import { realtimeRooms } from "@/lib/realtime/rooms";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; eventId: string; commentId: string }> }) {
  const { id, eventId, commentId } = await params;
  return handleCommentReaction(request, { communityId: id, targetId: eventId, commentId }, {
    commentTable: "event_comments",
    commentTargetColumn: "event_id",
    reactionColumn: "event_comment_id",
    parentTable: "community_events",
    room: realtimeRooms.eventComments,
  });
}
