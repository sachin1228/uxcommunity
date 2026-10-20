import { logEvent } from "./log";
import type { Env } from "./env";

/**
 * The scheduled driver for event lifecycle notifications.
 *
 * WHY IT LIVES IN THIS WORKER
 *   Cloudflare Cron Triggers are this project's only scheduler, and this Worker
 *   already holds API_URL / API_SECRET to reach the web app. Same shape as the
 *   chat retention sweep (see retention.ts): a thin POST, with the web side
 *   owning the querying, the delivery ledger and the Expo fan-out.
 *
 * WHY EVERY MINUTE
 *   The moments are clock-accurate — half an hour before, live at the start,
 *   ended at the end — so a five-minute tick would blur the half-hour call into
 *   "some time around then". A tick with nothing due is one indexed query per
 *   stage and returns immediately.
 *
 * Failures never throw into the scheduler: the stage's catch-up window (15
 * minutes) means the next tick can still deliver what this one missed.
 */
export async function runEventLifecycleNotifications(env: Env): Promise<void> {
  if (!env.API_URL || !env.API_SECRET) {
    logEvent("error", { event: "realtime.event_lifecycle.config_missing" });
    return;
  }

  try {
    const response = await fetch(`${env.API_URL}/api/internal/event-notifications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(45_000),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; summary?: Record<string, unknown> }
      | null;

    if (!response.ok || !payload?.ok) {
      logEvent("warn", {
        event: "realtime.event_lifecycle.run_failed",
        status: response.status,
      });
      return;
    }

    const summary = payload.summary ?? {};
    const due = Array.isArray(summary.due) ? summary.due : [];
    // Silent when there was nothing to send; the log is news, not a heartbeat.
    if (due.length === 0 && summary.notifications === 0) return;

    logEvent("info", {
      event: "realtime.event_lifecycle.run",
      due,
      notifications: summary.notifications ?? 0,
      push_messages: summary.pushMessages ?? 0,
      dead_tokens: summary.deadTokens ?? 0,
      complete: summary.complete === true,
      duration_ms: summary.durationMs ?? 0,
    });
  } catch (error) {
    logEvent("warn", { event: "realtime.event_lifecycle.unreachable", error });
  }
}
