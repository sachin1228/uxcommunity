// ─── Shared types & constants for the Communities admin section ───────────────

export interface CommunityMember {
  id: string;
  name: string;
  email: string;
  joined_at: string;
}

export interface CommunityMessage {
  id: string;
  content: string;
  created_at: string;
  user_name: string;
}

export interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  description: string | null;
  reference_id: string;
  reference_name: string | null;
  is_active: boolean;
  member_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
  members: CommunityMember[];
  messages: CommunityMessage[];
}

export const TYPE_LABELS: Record<string, string> = {
  city:             "City",
  sector:           "Industry",
  interest:         "Interest",
  company:          "Company",
  experience_level: "Experience",
};

export const TYPE_EMOJI: Record<string, string> = {
  city:             "📍",
  sector:           "🏢",
  interest:         "✦",
  company:          "🏬",
  experience_level: "🎯",
};

/** Includes border colour — used in the detail page type badge. */
export const TYPE_COLORS_WITH_BORDER: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sector:           "bg-purple-500/10 text-purple-400 border-purple-500/20",
  interest:         "bg-pink-500/10 text-pink-400 border-pink-500/20",
  company:          "bg-amber-500/10 text-amber-400 border-amber-500/20",
  experience_level: "bg-green-500/10 text-green-400 border-green-500/20",
};

/** No border — used in the list page type badge. */
export const TYPE_COLORS: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400",
  sector:           "bg-purple-500/10 text-purple-400",
  interest:         "bg-pink-500/10 text-pink-400",
  company:          "bg-amber-500/10 text-amber-400",
  experience_level: "bg-green-500/10 text-green-400",
};

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}
