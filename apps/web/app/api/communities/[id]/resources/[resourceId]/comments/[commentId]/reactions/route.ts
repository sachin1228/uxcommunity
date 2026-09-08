import { NextRequest } from "next/server";
import { handleCommentReaction } from "@/lib/communities/comment-reaction-route";
import { realtimeRooms } from "@/lib/realtime/rooms";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; resourceId: string; commentId: string }> }) {
  const { id, resourceId, commentId } = await params;
  return handleCommentReaction(request, { communityId: id, targetId: resourceId, commentId }, {
    commentTable: "resource_comments",
    commentTargetColumn: "resource_id",
    reactionColumn: "resource_comment_id",
    parentTable: "community_resources",
    room: realtimeRooms.resourceComments,
  });
}
