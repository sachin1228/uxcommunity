export const THREAD_CATEGORIES = [
  { value: "question", label: "Question" },
  { value: "discussion", label: "Discussion" },
  { value: "showcase", label: "Showcase" },
  { value: "resource", label: "Resource" },
  { value: "idea", label: "Idea" },
  { value: "feedback", label: "Feedback" },
  { value: "job", label: "Job" },
  { value: "collaboration", label: "Collaboration" },
] as const;

export type ThreadCategory = (typeof THREAD_CATEGORIES)[number]["value"];

export interface ThreadAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

export interface CommunityThread {
  id: string;
  community_id: string;
  user_id: string;
  title: string;
  description: string;
  category: ThreadCategory;
  tags: string[];
  attachments: ThreadAttachment[];
  links: string[];
  allow_replies: boolean;
  created_at: string;
  updated_at: string;
  vote_count: number;
  user_voted: boolean;
  comment_count: number;
  users: {
    name: string;
    avatar_url: string | null;
  } | null;
}

export interface ProfileThread extends CommunityThread {
  community: { name: string } | null;
}

export interface ThreadComment {
  id: string;
  thread_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  users: { name: string; avatar_url: string | null } | null;
  replies: ThreadComment[];
}
