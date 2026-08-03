export const RESOURCE_TYPES = [
  { value: "figma",       label: "Figma",        description: "Design files, prototypes, FigJam boards" },
  { value: "article",     label: "Article",       description: "Blog posts, tutorials, case studies" },
  { value: "tool",        label: "Tool",          description: "Software, plugins, browser extensions" },
  { value: "video",       label: "Video",         description: "Tutorials, talks, courses" },
  { value: "book",        label: "Book",          description: "Design books, handbooks, guides" },
  { value: "font",        label: "Font",          description: "Typefaces and typography resources" },
  { value: "icon_pack",   label: "Icon Pack",     description: "Icon sets, SVG libraries, illustration packs" },
  { value: "color",       label: "Color",         description: "Palettes, gradient tools, color systems" },
  { value: "template",    label: "Template",      description: "Mockups, presentation kits, portfolio starters" },
  { value: "inspiration", label: "Inspiration",   description: "Portfolios, design showcases, curated collections" },
  { value: "other",       label: "Other",         description: "Anything else worth sharing" },
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number]["value"];

export const RESOURCE_TAGS = [
  "UI Design",
  "UX Design",
  "Figma",
  "Design Systems",
  "Typography",
  "Color Theory",
  "Branding",
  "Illustration",
  "Iconography",
  "Motion Design",
  "Prototyping",
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
  "Free",
  "Open Source",
] as const;

export type ResourceTag = (typeof RESOURCE_TAGS)[number];

export interface CommunityResource {
  id: string;
  community_id: string;
  user_id: string;
  title: string;
  description: string | null;
  resource_type: ResourceType;
  url: string;
  tags: string[];
  is_public?: boolean;
  created_at: string;
  updated_at: string;
  // enriched
  save_count: number;
  user_saved: boolean;
  comment_count: number;
  bookmark_count: number;
  user_bookmarked: boolean;
  users: {
    name: string;
    avatar_url: string | null;
  } | null;
}

export interface ResourceComment {
  id: string;
  resource_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  users: { name: string; avatar_url: string | null } | null;
  replies: ResourceComment[];
}
