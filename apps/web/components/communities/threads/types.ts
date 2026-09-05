/** Max body (title) length for threads — mirrors the DB column + API validation. */
export const THREAD_BODY_MAX_LENGTH = 2000;

export const THREAD_TAGS = [
  "UI/UX",
  "Product Design",
  "Graphic Design",
  "Design Systems",
  "Web Design",
  "Mobile Design",
  "Branding",
  "Illustration",
  "3D / Motion",
  "Typography",
  "Tools & Workflow",
  "Career",
  "Other",
] as const;

export type ThreadTag = (typeof THREAD_TAGS)[number];

export const THREAD_CATEGORIES = [
  { value: "question", label: "Question" },
  { value: "discussion", label: "Discussion" },
  { value: "idea", label: "Idea" },
  { value: "feedback", label: "Feedback" },
  { value: "referral", label: "Referral" },
  { value: "collaboration", label: "Collaboration" },
] as const;

export type ThreadCategory = (typeof THREAD_CATEGORIES)[number]["value"];

// ── Polls ────────────────────────────────────────────────────────────────────

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_QUESTION_MAX_LENGTH = 200;
export const POLL_OPTION_MAX_LENGTH = 100;

export interface ThreadPoll {
  question: string;
  options: string[];
}

/** Editable (draft) form of a poll used by the composers. */
export interface ThreadPollDraft {
  question: string;
  options: string[];
}

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
  category: ThreadCategory;
  tags: string[];
  attachments: ThreadAttachment[];
  links: string[];
  allow_replies: boolean;
  is_public?: boolean;
  poll?: ThreadPoll | null;
  /** Per-option vote totals (aligned with poll.options) + the viewer's vote. */
  poll_vote_counts?: number[];
  poll_user_vote?: number | null;
  created_at: string;
  updated_at: string;
  like_count: number;
  user_liked: boolean;
  user_saved: boolean;
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
