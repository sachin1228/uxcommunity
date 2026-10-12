/**
 * Server-side loaders for the Settings tree.
 *
 * Settings is a two-level drill-down — an index of category rows, then one page
 * per category — so every page reads only the rows its own card renders instead
 * of the whole page loading everything up front.
 *
 * The defaults and the "HH:MM" clock conversion live here, together, because
 * the Notifications and Email pages read the same `notification_preferences`
 * row and must agree with what `/api/push/settings` serves for someone who has
 * never saved a switch.
 */

import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/push/chat";
import { createServiceClient } from "@/lib/supabase/service";
import { clockHHMM, type EmailPreferences, type PushPreferences } from "./preferences";
import type { SavedResume } from "./resumes";

/** Every column the two preference shapes read, in one select. */
const PREFERENCE_COLUMNS =
  "chat_push_enabled, community_push_enabled, chat_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, email_job_updates, email_community_activity, email_product_news";

export interface AccountSummary {
  /** The account email; falls back to the session's when the row is missing. */
  email: string;
  /** Preformatted ("October 2026"); null when the join date is unknown. */
  memberSince: string | null;
}

export interface NotificationPreferences {
  push: PushPreferences;
  email: EmailPreferences;
}

export interface JobProfileData {
  portfolioUrl: string;
  resumes: SavedResume[];
}

/** The Account page's two read-only identity rows. */
export async function loadAccount(
  userId: string,
  fallbackEmail: string,
): Promise<AccountSummary> {
  const { data } = await createServiceClient()
    .from("users")
    .select("email, created_at")
    .eq("id", userId)
    .maybeSingle();

  return {
    email: data?.email ?? fallbackEmail,
    memberSince: data?.created_at
      ? new Date(data.created_at).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })
      : null,
  };
}

/**
 * The chat and email switches, defaulted the same way the push API defaults
 * them. Kept as one read because both the Notifications and Email pages come
 * from this single `notification_preferences` row.
 */
export async function loadNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const { data } = await createServiceClient()
    .from("notification_preferences")
    .select(PREFERENCE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    push: {
      chatPushEnabled:
        data?.chat_push_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.chat_push_enabled,
      communityPushEnabled:
        data?.community_push_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.community_push_enabled,
      chatSound: data?.chat_sound === "silent" ? "silent" : "default",
      quietHoursEnabled:
        data?.quiet_hours_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_enabled,
      quietHoursStart: clockHHMM(
        data?.quiet_hours_start,
        DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_start,
      ),
      quietHoursEnd: clockHHMM(
        data?.quiet_hours_end,
        DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_end,
      ),
    },
    email: {
      emailJobUpdates: data?.email_job_updates ?? true,
      emailCommunityActivity: data?.email_community_activity ?? true,
      emailProductNews: data?.email_product_news ?? false,
    },
  };
}

/** The Job profile page: the portfolio link plus the saved resumes. */
export async function loadJobProfile(userId: string): Promise<JobProfileData> {
  const db = createServiceClient();
  const [{ data: profile }, { data: resumes }] = await Promise.all([
    db.from("designer_profiles").select("portfolio_url").eq("user_id", userId).maybeSingle(),
    db
      .from("member_resumes")
      .select("id, file_name, mime_type, size_bytes, url, is_default, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  return {
    portfolioUrl: profile?.portfolio_url ?? "",
    resumes: (resumes ?? []).map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      url: row.url,
      isDefault: row.is_default,
      createdAt: row.created_at,
    })),
  };
}
