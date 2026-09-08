import { NextRequest } from "next/server";
import { handleCommentReaction } from "@/lib/communities/comment-reaction-route";
import { realtimeRooms } from "@/lib/realtime/rooms";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; postId: string; commentId: string }> }) {
  const { id, postId, commentId } = await params;
  return handleCommentReaction(request, { communityId: id, targetId: postId, commentId }, {
    commentTable: "showcase_comments",
    commentTargetColumn: "post_id",
    reactionColumn: "showcase_comment_id",
    parentTable: "community_showcase_posts",
    room: realtimeRooms.showcase,
  });
}
