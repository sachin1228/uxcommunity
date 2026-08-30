export type ShowcaseCategory = "ui_ux" | "branding" | "illustration" | "motion" | "product" | "other";

export const SHOWCASE_CATEGORIES: { value: ShowcaseCategory | "all"; label: string }[] = [
  { value: "all", label: "All work" }, { value: "ui_ux", label: "UI/UX" }, { value: "branding", label: "Branding" },
  { value: "illustration", label: "Illustration" }, { value: "motion", label: "Motion" }, { value: "product", label: "Product" }, { value: "other", label: "Other" },
];
export interface ShowcasePost {
  id: string; community_id: string; user_id: string; title: string;
  image_url: string; category: ShowcaseCategory; created_at: string; updated_at: string;
  is_public: boolean; allow_replies: boolean; like_count: number; comment_count: number; user_liked: boolean; user_saved: boolean;
  author: { name: string; avatar_url: string | null };
}

export interface ShowcaseComment {
  id: string; post_id: string; user_id: string; parent_id: string | null; body: string; created_at: string; updated_at: string;
  users: { name: string; avatar_url: string | null } | null;
  replies: ShowcaseComment[];
}
