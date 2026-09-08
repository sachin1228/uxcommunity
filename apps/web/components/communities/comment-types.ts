export const COMMENT_REACTIONS = ["👍", "❤️", "🎉", "💡", "👏"] as const;

export type CommentReactionEmoji = (typeof COMMENT_REACTIONS)[number];
export type CommentSort = "newest" | "popular";

export interface CommentReactionSummary {
  emoji: CommentReactionEmoji;
  count: number;
  reacted: boolean;
}

export interface CommunityCommentBase {
  id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  image_url?: string | null;
  users: { name: string; avatar_url: string | null } | null;
  reactions?: CommentReactionSummary[];
  reaction_count?: number;
  replies?: CommunityCommentBase[];
}

export type CommentKind = "threads" | "resources" | "showcase" | "events";
