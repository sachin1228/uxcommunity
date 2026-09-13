import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Signup funnel tracking.
 *
 * The account is not created until the final step (`complete_signup`), so a
 * member who enters their email and then bounces leaves no trace anywhere else.
 * These helpers record a row on step 1 and flip it to `completed` once the
 * account exists — the admin "Incomplete Signups" page reads the leftovers.
 *
 * Every write is best-effort: a tracking failure must never break signup (for
 * example if the `signup_attempts` migration hasn't been applied yet).
 */

export type SignupFlow = "direct" | "invitation";

/**
 * Upserts the email's attempt row, refreshing `started_at`/`name` for repeat
 * visits. Call this only AFTER step-1 validation passes — a rejected email
 * (bad password, existing account, blocked name) isn't a dropped signup.
 */
export async function recordSignupAttempt(input: {
  email: string;
  name?: string | null;
  flow: SignupFlow;
  applicationId?: string | null;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email) return;

  try {
    const db = createServiceClient();
    const { error } = await (db.from("signup_attempts") as any).upsert(
      {
        email,
        name: input.name?.trim() || null,
        flow: input.flow,
        application_id: input.applicationId ?? null,
        status: "started",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    );
    if (error) console.error("[signup-attempts] record failed:", error);
  } catch (error) {
    console.error("[signup-attempts] record error:", error);
  }
}

/**
 * Marks the email's attempt row as completed once the account has been created.
 * No-op when there is no row (e.g. accounts created before tracking existed).
 */
export async function markSignupCompleted(
  email: string,
  userId: string | null
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  try {
    const db = createServiceClient();
    const now = new Date().toISOString();
    const { error } = await (db.from("signup_attempts") as any)
      .update({
        status: "completed",
        user_id: userId,
        completed_at: now,
        updated_at: now,
      })
      .eq("email", normalized);
    if (error) console.error("[signup-attempts] completion mark failed:", error);
  } catch (error) {
    console.error("[signup-attempts] completion mark error:", error);
  }
}
