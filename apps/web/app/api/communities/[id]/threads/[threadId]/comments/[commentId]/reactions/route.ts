import { NextRequest } from "next/server";
import { handleCommentReaction } from "@/lib/communities/comment-reaction-route";
import { realtimeRooms } from "@/lib/realtime/rooms";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; threadId: string; commentId: string }> }) {
  const { id, threadId, commentId } = await params;
  return handleCommentReaction(request, { communityId: id, targetId: threadId, commentId }, {
    commentTable: "thread_comments",
    commentTargetColumn: "thread_id",
    reactionColumn: "thread_comment_id",
    parentTable: "community_threads",
    room: realtimeRooms.threadComments,
  });
}
