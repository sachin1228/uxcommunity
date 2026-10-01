// ─── Shared types & constants for the Communities admin section ───────────────

import {
  ALL_COMMUNITY_PERMISSIONS,
  MODERATOR_PERMISSION_OPTIONS,
  type CommunityPermission,
  type CommunityPermissions,
} from "@/lib/communities/permissions";

export interface CommunityMember {
  id: string;
  name: string;
  email: string;
  joined_at: string;
  /** "owner" | "admin" | "moderator" | "member" (defaults to member when absent). */
  role?: string;
}

export interface CommunityMessage {
  id: string;
  content: string;
  created_at: string;
  user_name: string;
}

/** Row shape returned by the paginated member search API. */
export interface CommunityMemberSearchResult {
  user_id: string;
  name: string;
  email: string;
  joined_at: string;
  role: string;
}

export interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
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
// The catalogue lives in lib/communities/permissions so the platform dashboard
// and the owner-facing members UI grant from the same list.

export type CommunityPermissionFlags = CommunityPermissions;

export type CommunityPermissionKey = CommunityPermission;

export const ALL_PERMISSIONS = ALL_COMMUNITY_PERMISSIONS;

export const PERMISSION_OPTIONS = MODERATOR_PERMISSION_OPTIONS;

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
  actor_role: "owner" | "admin" | "moderator" | "platform";
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
  job_title:        "Job Title",
  general:          "General",
  user:             "Member",
};

/** Includes border colour — used in the detail page type badge. */
export const TYPE_COLORS_WITH_BORDER: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sector:           "bg-purple-500/10 text-purple-400 border-purple-500/20",
  interest:         "bg-pink-500/10 text-pink-400 border-pink-500/20",
  experience_level: "bg-green-500/10 text-green-400 border-green-500/20",
  job_title:        "bg-orange-500/10 text-orange-400 border-orange-500/20",
  general:          "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

/** No border — used in the list page type badge. */
export const TYPE_COLORS: Record<string, string> = {
  city:             "bg-blue-500/10 text-blue-400",
  sector:           "bg-purple-500/10 text-purple-400",
  interest:         "bg-pink-500/10 text-pink-400",
  experience_level: "bg-green-500/10 text-green-400",
  job_title:        "bg-orange-500/10 text-orange-400",
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
