export const THREAD_TAGS = [
  "UI Design",
  "UX Design",
  "Typography",
  "Color Theory",
  "Layout",
  "Branding",
  "Illustration",
  "Iconography",
  "Motion Design",
  "Design Systems",
  "Prototyping",
  "Figma",
  "User Research",
  "Accessibility",
  "Mobile Design",
  "Web Design",
  "Product Design",
  "Interaction Design",
  "Components",
  "Dark Mode",
  "Responsive Design",
  "Portfolio",
  "Freelance",
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
