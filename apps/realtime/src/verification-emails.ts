import { jobsEnabled } from "../../../packages/shared/src/environment";
import { logEvent } from "./log";
import type { Env } from "./env";

/**
 * The scheduled driver for reapply-eligible emails.
 *
 * Same shape as the event lifecycle driver: a thin authenticated POST to the
 * web app on the every-minute cron. The web side owns the query, the Resend
 * send and the `verification_notified_at` ledger, so a retried tick cannot
 * send the same member the email twice.
 */
export async function runVerificationReapplyEmails(env: Env): Promise<void> {
  if (!jobsEnabled({ APP_ENV: env.APP_ENV })) return;
  if (!env.API_URL || !env.API_SECRET) {
    logEvent("error", { event: "realtime.verification_reapply.config_missing" });
    return;
  }

  try {
    const response = await fetch(`${env.API_URL}/api/internal/verification-reapply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(45_000),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; summary?: { due?: number; sent?: number; failed?: number } }
      | null;

    if (!response.ok || !payload?.ok) {
      logEvent("warn", {
        event: "realtime.verification_reapply.run_failed",
        status: response.status,
      });
      return;
    }

    const sent = payload.summary?.sent ?? 0;
    const failed = payload.summary?.failed ?? 0;
    if (sent === 0 && failed === 0) return;

    logEvent("info", {
      event: "realtime.verification_reapply.run",
      due: payload.summary?.due ?? 0,
      sent,
      failed,
    });
  } catch (error) {
    logEvent("warn", { event: "realtime.verification_reapply.unreachable", error });
  }
}
