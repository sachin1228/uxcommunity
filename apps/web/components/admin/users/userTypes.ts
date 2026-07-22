// ─── Shared types & constants for the Users admin section ────────────────────

export interface UserProfile {
  experience_level: string;
  avatar_url?: string | null;
  avatar_source?: string | null;
  companies: { name: string } | null;
  cities: { name: string } | null;
  design_sectors: { name: string } | null;
}

export interface UserInterest {
  id: string;
  name: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  is_blocked: boolean;
  created_at: string;
  application_id: string | null;
  designer_profiles: UserProfile | null;
}

export interface UserApplication {
  linkedin_url: string | null;
  portfolio_url: string | null;
}

// Legacy label map for users who signed up before the experience_level column
// was migrated from a PG enum to text. New signups store the slug directly from
// the experience_levels table, so UserInfoCard falls back to the raw slug value
// if no entry is found here.
export const EXPERIENCE_LABELS: Record<string, string> = {
  student:        "Student",
  fresher:        "Fresher (0–1 yrs)",
  junior:         "Junior Designer (1–3 yrs)",
  mid_level:      "Mid-Level Designer (3–5 yrs)",
  senior:         "Senior Designer (5–8 yrs)",
  lead:           "Lead Designer (8–12 yrs)",
  principal:      "Principal Designer",
  staff:          "Staff Designer",
  design_manager: "Design Manager",
  head_of_design: "Head of Design",
  director:       "Director of Design",
  vp:             "VP of Design",
  consultant:     "Design Consultant",
  freelancer:     "Freelancer",
};

export const AVATAR_SOURCE_LABELS: Record<string, string> = {
  dicebear:         "DiceBear (generated)",
  "boring-avatars": "Boring Avatars (generated)",
  robohash:         "Robohash (generated)",
  upload:           "Custom upload",
};
