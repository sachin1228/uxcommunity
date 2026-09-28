/**
 * Structured logging for the realtime Worker.
 *
 * WHY THIS EXISTS (production-readiness audit, M-6)
 *   The realtime service already had counters (see `metrics.ts`) but its
 *   failure paths either logged a free-form `console.error("…", err)` or
 *   nothing at all, so a production incident could not be filtered or counted
 *   by event. This emits ONE JSON line per event with a stable `event` name and
 *   a small, allow-listed metadata object.
 *
 * WHAT MUST NEVER BE LOGGED
 *   JWTs, session cookies, push tokens, message/user content, email addresses,
 *   IPs. Callers pass ids (community/user/room) and numbers only. Ids must
 *   already be safe in this service's own metrics/stats output — this logger
 *   adds no new exposure beyond what `/stats` already surfaces to operators.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  /** Stable, greppable event name, e.g. "realtime.publish.fanout_failed". */
  event: string;
  /** Safe ids/counts only — never tokens, cookies or content. */
  [key: string]: unknown;
}

/**
 * Emit one structured line. `event` is always present and always first so log
 * pipelines can key on it; `err` is reduced to name + message (never a stack
 * with embedded values).
 */
export function logEvent(level: LogLevel, fields: LogFields): void {
  const { event, error, ...rest } = fields as LogFields & { error?: unknown };
  const line: Record<string, unknown> = {
    event,
    level,
    ts: new Date().toISOString(),
    ...rest,
  };
  if (error) {
    const err = error as { name?: unknown; message?: unknown };
    line.error_name = typeof err?.name === "string" ? err.name : "Error";
    line.error_message = typeof err?.message === "string" ? err.message : String(error);
  }

  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}
