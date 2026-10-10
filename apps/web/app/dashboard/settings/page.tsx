import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/push/chat";
import {
  clockHHMM,
  type EmailPreferences,
  type PushPreferences,
} from "@/lib/settings/preferences";
import type { SavedResume } from "@/lib/settings/resumes";
import { SettingsView } from "./SettingsView";

export const metadata = { title: "Settings" };

/**
 * The member's Settings: account, notifications, email, connected accounts and
 * the job profile (portfolio link + up to three saved resumes).
 *
 * The page loads every row the cards render — user, profile portfolio, push
 * settings and saved resumes — and hands them to SettingsView; the mutations
 * live in that client tree and write straight to the APIs (push settings,
 * profile, settings/resumes). The notifications row may not exist yet for
 * someone who has never saved a switch, so its defaults come from the same
 * `DEFAULT_NOTIFICATION_PREFERENCES` the push API serves.
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const userId = session.userId!;

  const [{ data: user }, { data: profile }, { data: preferences }, { data: resumes }] =
    await Promise.all([
      db.from("users").select("name, email, created_at").eq("id", userId).maybeSingle(),
      db.from("designer_profiles").select("portfolio_url").eq("user_id", userId).maybeSingle(),
      db
        .from("notification_preferences")
        .select(
          "chat_push_enabled, chat_sound, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, email_job_updates, email_community_activity, email_product_news"
        )
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("member_resumes")
        .select("id, file_name, mime_type, size_bytes, url, is_default, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  const pushPreferences: PushPreferences = {
    chatPushEnabled:
      preferences?.chat_push_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.chat_push_enabled,
    chatSound: preferences?.chat_sound === "silent" ? "silent" : "default",
    quietHoursEnabled:
      preferences?.quiet_hours_enabled ?? DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_enabled,
    quietHoursStart: clockHHMM(
      preferences?.quiet_hours_start,
      DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_start,
    ),
    quietHoursEnd: clockHHMM(
      preferences?.quiet_hours_end,
      DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_end,
    ),
  };

  const emailPreferences: EmailPreferences = {
    emailJobUpdates: preferences?.email_job_updates ?? true,
    emailCommunityActivity: preferences?.email_community_activity ?? true,
    emailProductNews: preferences?.email_product_news ?? false,
  };

  const savedResumes: SavedResume[] = (resumes ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: row.url,
    isDefault: row.is_default,
    createdAt: row.created_at,
  }));

  return (
    <SettingsView
      email={user?.email ?? session.email ?? ""}
      memberSince={memberSince}
      pushPreferences={pushPreferences}
      emailPreferences={emailPreferences}
      portfolioUrl={profile?.portfolio_url ?? ""}
      resumes={savedResumes}
    />
  );
}
