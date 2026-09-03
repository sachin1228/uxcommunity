// ─── Shared types & constants for the Communities admin section ───────────────

export interface CommunityMember {
  id: string;
  name: string;
  email: string;
  joined_at: string;
  /** "owner" | "admin" | "member" (defaults to member when absent). */
  role?: string;
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
  lottie_url?: string | null;
  lottie_format?: "json" | "dotlottie" | null;
  lottie_data?: unknown;
  description: string | null;
  reference_id: string;
  reference_name: string | null;
  /** Set when a member created the community — app-created ones have null. */
  owner_id?: string | null;
  /** Communities the platform auto-created (no member owner) — where admins apply. */
  is_app_created?: boolean;
  is_active: boolean;
  member_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
  members: CommunityMember[];
  messages: CommunityMessage[];
}

// ─── Community admin permissions ────────────────────────────────────────────

export interface CommunityPermissionFlags {
  can_edit_settings: boolean;
  can_manage_members: boolean;
  can_delete_messages: boolean;
}

export type CommunityPermissionKey = keyof CommunityPermissionFlags;

export const ALL_PERMISSIONS: CommunityPermissionFlags = {
  can_edit_settings: true,
  can_manage_members: true,
  can_delete_messages: true,
};

export const PERMISSION_OPTIONS: Array<{
  key: CommunityPermissionKey;
  label: string;
  description: string;
}> = [
  {
    key: "can_edit_settings",
    label: "Edit community settings",
    description: "Rename the community and update its photo, description, rules and tabs (the gear in the app).",
  },
  {
    key: "can_manage_members",
    label: "Manage members",
    description: "Remove members and accept / decline join requests.",
  },
  {
    key: "can_delete_messages",
    label: "Moderate chat messages",
    description: "Delete any member's messages in the community chat.",
  },
];

export interface CommunityAdmin {
  user_id: string;
  name: string;
  email: string;
  joined_at: string;
  permissions: CommunityPermissionFlags;
  granted_at: string;
  updated_at: string | null;
}

export interface CommunityActivityEntry {
  id: string;
  community_id: string;
  actor_id: string | null;
  actor_role: "owner" | "admin" | "platform";
  actor_name: string | null;
  action: string;
  target_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export const TYPE_LABELS: Record<string, string> = {
  city:             "City",
  sector:           "Industry",
  interest:         "Interest",
  experience_level: "Experience",
  general:          "General",
  user:             "Member",
};

/** Includes border colour — used in the detail page type badge. */
export const TYPE_COLORS_WITH_BORDER: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sector:           "bg-purple-500/10 text-purple-400 border-purple-500/20",
  interest:         "bg-pink-500/10 text-pink-400 border-pink-500/20",
  experience_level: "bg-green-500/10 text-green-400 border-green-500/20",
  general:          "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

/** No border — used in the list page type badge. */
export const TYPE_COLORS: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400",
  sector:           "bg-purple-500/10 text-purple-400",
  interest:         "bg-pink-500/10 text-pink-400",
  experience_level: "bg-green-500/10 text-green-400",
  general:          "bg-cyan-500/10 text-cyan-400",
  user:             "bg-amber-500/10 text-amber-400",
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
