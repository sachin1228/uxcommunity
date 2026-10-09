import { DurableObject } from "cloudflare:workers";
import { decideAlert, type DependencyReportLite, type MonitorState } from "./alert-policy";
import { logEvent } from "./log";
import type { Env } from "./env";

/**
 * The scheduled dependency monitor.
 *
 * WHY IT LIVES IN THIS WORKER
 *   Something has to run when nobody is looking, and Cloudflare Cron Triggers
 *   are the only scheduler this project has. The realtime Worker already owns
 *   the app's Durable Objects and is deployed on every merge, so a monitor here
 *   needs no new deployable, no new repository secret, and no manual resource
 *   — it reuses the API_URL / API_SECRET pair the membership check already
 *   uses. A Node-only monitor (a GitHub Actions cron) would have burned the
 *   private-repo minutes for a check that must run every five minutes.
 *
 * WHAT IT DOES, ONCE PER CRON TICK
 *   1. GET {API_URL}/api/internal/dependency-health — the web app runs the
 *      checks and returns the report (that endpoint owns what an alert says and
 *      who receives it; this Worker holds no email credential).
 *   2. Ask alert-policy.ts whether this run should alert. The state it decides
 *      from lives in this object's durable storage, so a redeploy or a cold
 *      isolate cannot lose "already told them" and start spamming hourly.
 *   3. If an alert is due, POST the same endpoint with the kind — the web app
 *      re-runs the checks itself and sends the email.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *   Alert about the web app being unreachable. The email is sent BY the web app,
 *   so a web-app outage is unalertable from here by construction; that failure
 *   is logged as `realtime.alert_monitor.unreachable` instead, for whatever
 *   watches this Worker's logs. Claiming otherwise in an email would be a lie.
 */
export class AlertMonitor extends DurableObject<Env> {
  /** One instance is used: `idFromName("dependency-monitor")`. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Read-only view of what the monitor knows, for debugging and smoke tests.
    if (url.pathname.endsWith("/state")) {
      const state = (await this.ctx.storage.get<MonitorState>("state")) ?? null;
      return Response.json({ ok: true, state });
    }

    return this.run();
  }

  private async run(): Promise<Response> {
    if (!this.env.API_URL || !this.env.API_SECRET) {
      logEvent("error", { event: "realtime.alert_monitor.config_missing" });
      return Response.json({ ok: false, reason: "API_URL / API_SECRET not configured" });
    }

    const report = await this.fetchReport();
    if (!report) return Response.json({ ok: false, reason: "health endpoint unreachable" });

    const previous = (await this.ctx.storage.get<MonitorState>("state")) ?? null;
    const decision = decideAlert(previous, report, Date.now());
    await this.ctx.storage.put("state", decision.state);

    logEvent("info", {
      event: "realtime.alert_monitor.run",
      notify: decision.notify ?? "none",
      reason: decision.reason,
      down: decision.state.downIds.join(","),
    });

    if (decision.notify) {
      // On recovery the state has already been cleared, so the ids that were
      // down come from the state this run started with — the email should name
      // what actually recovered, not every monitored service.
      const ids = decision.notify === "recovered" ? (previous?.downIds ?? []) : decision.state.downIds;
      await this.requestAlert(decision.notify, ids);
    }

    return Response.json({
      ok: true,
      notify: decision.notify,
      reason: decision.reason,
      state: decision.state,
    });
  }

  /** Reads the report; null means the web app did not answer. */
  private async fetchReport(): Promise<DependencyReportLite | null> {
    try {
      const response = await fetch(`${this.env.API_URL}/api/internal/dependency-health`, {
        headers: { Authorization: `Bearer ${this.env.API_SECRET}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logEvent("warn", {
          event: "realtime.alert_monitor.unreachable",
          status: response.status,
        });
        return null;
      }
      const payload = (await response.json()) as { report?: DependencyReportLite };
      if (!payload?.report) {
        logEvent("warn", { event: "realtime.alert_monitor.bad_payload" });
        return null;
      }
      return payload.report;
    } catch (error) {
      logEvent("warn", {
        event: "realtime.alert_monitor.unreachable",
        status: 0,
        detail: error instanceof Error ? error.message : "unknown",
      });
      return null;
    }
  }

  /**
   * Asks the web app to send the alert.
   *
   * A failure here is logged, not retried: the next cron tick is five minutes
   * away and still carries the same state, so a transient send failure resolves
   * itself — and a send failure must never crash the monitor.
   */
  private async requestAlert(kind: "down" | "recovered", ids: string[]): Promise<void> {
    try {
      const response = await fetch(`${this.env.API_URL}/api/internal/dependency-health`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.API_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind, ids }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logEvent("warn", { event: "realtime.alert_monitor.alert_failed", status: response.status });
        return;
      }
      const payload = (await response.json()) as { alerted?: { sent?: boolean; reason?: string } };
      logEvent("info", {
        event: "realtime.alert_monitor.alert_sent",
        kind,
        sent: payload?.alerted?.sent ?? false,
        reason: payload?.alerted?.reason ?? "",
      });
    } catch (error) {
      logEvent("warn", {
        event: "realtime.alert_monitor.alert_failed",
        status: 0,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}
