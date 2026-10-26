import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { sendVerificationReapplyEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications";

export interface ReapplyEmailSummary {
  due: number;
  sent: number;
  failed: number;
}

/**
 * Sends the one-time "you can reapply" email when a rejected member's
 * one-month window opens. The sent timestamp is the ledger: a retried or
 * overlapping cron tick cannot send it twice.
 */
export async function runVerificationReapplyEmails(): Promise<ReapplyEmailSummary> {
  const db = createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("users")
    .select("id, name, email, verification_reapply_at")
    .eq("verification_status", "rejected")
    .lte("verification_reapply_at", now)
    .is("verification_notified_at", null)
    .order("verification_reapply_at", { ascending: true })
    .limit(200);

  if (error) {
    throw new Error(`verification reapply query failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string | null;
    email: string;
    verification_reapply_at: string | null;
  }>;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.verification_reapply_at) continue;
    const label = new Date(row.verification_reapply_at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    try {
      await sendVerificationReapplyEmail(row.email, row.name?.trim() || "there", label);
      await db
        .from("users")
        .update({ verification_notified_at: new Date().toISOString() })
        .eq("id", row.id);

      await createNotification(db, {
        userId: row.id,
        actorId: null,
        type: "verification_reapply_ready",
        entityType: "verification",
        entityId: row.id,
        title: "You can reapply for verification",
        body: `Your reapplication window is open. Update your profile and submit again.`,
        href: "/dashboard/verification",
      });
      sent += 1;
    } catch (emailError) {
      failed += 1;
      console.error("[verification/reapply] send error:", emailError);
    }
  }

  return { due: rows.length, sent, failed };
}
