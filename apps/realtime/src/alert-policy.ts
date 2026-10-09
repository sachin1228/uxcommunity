/**
 * When the dependency monitor should email an admin.
 *
 * Kept pure and separate from the Durable Object that stores the state, so
 * every transition — first outage, reminder, new dependency joining an outage,
 * recovery — is testable without workerd, and so the rule can be read in one
 * place instead of being spread through storage calls.
 *
 * The rules, and why:
 *   - up → down            notify immediately. This is the whole point: the
 *                          2026-10-09 upload outage was found by a member
 *                          because nobody was told.
 *   - down → down          notify again only after the cooldown, so a service
 *                          that stays broken for a day does not send 288 emails.
 *   - down → down, but a
 *     different set broke  notify immediately. The cooldown exists to stop
 *                          repeats, not to hide a second, unrelated outage.
 *   - down → up            notify once, so the loop is closed and nobody has to
 *                          wonder whether it is still broken.
 *   - up → up              stay quiet.
 *
 * `alerts` at the web layer decides WHICH dependencies are worth waking someone
 * for (see apps/web/lib/health/dependencies.ts): a dead GIPHY key never reaches
 * this file as an outage, because the report's `alerts` list only carries the
 * checks that matter.
 */

/** The shape of the report this policy needs; the monitor fetches the rest. */
export interface DependencyReportLite {
  checkedAt?: string;
  healthy?: boolean;
  allOk?: boolean;
  /** Unhealthy checks worth paging about, as the web app defines them. */
  alerts?: Array<{ id: string; label?: string; status?: string; detail?: string }>;
}

/** What the monitor remembers between runs. */
export interface MonitorState {
  status: "up" | "down";
  /** Ids that were down at the last notified run, sorted for comparison. */
  downIds: string[];
  /** Epoch ms of the last alert email, 0 when none has been sent yet. */
  lastNotifiedAt: number;
}

export type AlertKind = "down" | "recovered";

export interface AlertDecision {
  /** What the monitor should ask the web app to send, if anything. */
  notify: AlertKind | null;
  /** The state to persist for the next run. */
  state: MonitorState;
  /** Why this decision was made — logged on every run, alerted or not. */
  reason: string;
}

/** One reminder per hour while a dependency stays down. */
export const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/** The ids currently worth paging about, sorted so two runs are comparable. */
export function downIdsOf(report: DependencyReportLite): string[] {
  const ids = (report.alerts ?? [])
    .filter((entry) => entry?.id)
    .map((entry) => String(entry.id));
  return Array.from(new Set(ids)).sort();
}

/**
 * Decides whether to alert, and what the next state is.
 *
 * @param previous State stored by the last run, or null on the first run ever.
 * @param report The report just fetched from the web app.
 * @param now Epoch ms, injected so the cooldown is testable.
 * @param cooldownMs Reminder interval while a dependency stays down.
 */
export function decideAlert(
  previous: MonitorState | null,
  report: DependencyReportLite,
  now: number,
  cooldownMs: number = ALERT_COOLDOWN_MS,
): AlertDecision {
  const downIds = downIdsOf(report);
  const down = downIds.length > 0;

  if (!down) {
    if (previous && previous.status === "down") {
      return {
        notify: "recovered",
        state: { status: "up", downIds: [], lastNotifiedAt: now },
        reason: `recovered (was down: ${previous.downIds.join(", ") || "unknown"})`,
      };
    }
    return {
      notify: null,
      state: { status: "up", downIds: [], lastNotifiedAt: previous?.lastNotifiedAt ?? 0 },
      reason: "healthy",
    };
  }

  // First run ever: report the outage rather than waiting for the next state
  // change, which is exactly what a monitor starting during an incident must do.
  if (!previous) {
    return {
      notify: "down",
      state: { status: "down", downIds, lastNotifiedAt: now },
      reason: `first observation: down (${downIds.join(", ")})`,
    };
  }

  if (previous.status === "up") {
    return {
      notify: "down",
      state: { status: "down", downIds, lastNotifiedAt: now },
      reason: `went down (${downIds.join(", ")})`,
    };
  }

  const previousIds = [...previous.downIds].sort().join(",");
  const currentIds = downIds.join(",");
  if (previousIds !== currentIds) {
    return {
      notify: "down",
      state: { status: "down", downIds, lastNotifiedAt: now },
      reason: `still down and the set changed (${previousIds || "none"} → ${currentIds})`,
    };
  }

  if (now - previous.lastNotifiedAt >= cooldownMs) {
    return {
      notify: "down",
      state: { status: "down", downIds, lastNotifiedAt: now },
      reason: `still down after the reminder cooldown (${downIds.join(", ")})`,
    };
  }

  return {
    notify: null,
    state: { ...previous, downIds },
    reason: `still down, reminder not due for ${Math.max(
      0,
      Math.round((cooldownMs - (now - previous.lastNotifiedAt)) / 60_000),
    )} more minute(s)`,
  };
}
