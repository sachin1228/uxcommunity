import { logEvent } from "./log";
import type { Env } from "./env";

/**
 * The scheduled driver for the community chat's 15-day retention sweep.
 *
 * WHY IT LIVES IN THIS WORKER
 *   Same reasoning as the dependency monitor (see alert-monitor.ts): Cloudflare
 *   Cron Triggers are the only scheduler this project has, and this Worker
 *   already holds the API_URL / API_SECRET pair needed to reach the web app.
 *   Unlike the monitor there is no state to keep — a sweep is idempotent, so a
 *   retry or a mid-run deploy changes nothing — which is why this is a plain
 *   fetch instead of a Durable Object.
 *
 * WHAT IT DOES, ONCE PER CRON TICK
 *   POSTs {API_URL}/api/internal/community-message-retention. The web app runs
 *   the sweep (delete expired messages + their R2 images, announce to affected
 *   rooms) and answers with a summary, which is logged as a single structured
 *   line. A run that stops early (its own wall-clock budget) reports
 *   `complete: false` with the remaining backlog; the next tick continues.
 *
 *   Failures here never throw into the scheduler: the next tick is six hours
 *   away and still carries the same backlog, so nothing is lost by logging and
 *   returning.
 */
export async function runRetentionSweep(env: Env): Promise<void> {
  if (!env.API_URL || !env.API_SECRET) {
    logEvent("error", { event: "realtime.retention.config_missing" });
    return;
  }

  try {
    const response = await fetch(`${env.API_URL}/api/internal/community-message-retention`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60_000),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; summary?: Record<string, unknown> }
      | null;

    if (!response.ok || !payload?.ok) {
      logEvent("warn", {
        event: "realtime.retention.run_failed",
        status: response.status,
      });
      return;
    }

    const summary = payload.summary ?? {};
    logEvent("info", {
      event: "realtime.retention.run",
      deleted_messages: summary.deletedMessages ?? 0,
      deleted_images: summary.deletedImages ?? 0,
      communities: summary.communities ?? 0,
      batches: summary.batches ?? 0,
      complete: summary.complete === true,
      pending_messages: summary.pendingMessages ?? 0,
      duration_ms: summary.durationMs ?? 0,
    });
  } catch (error) {
    logEvent("warn", {
      event: "realtime.retention.unreachable",
      error,
    });
  }
}
