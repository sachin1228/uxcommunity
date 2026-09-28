/**
 * Structured logging for the web (Next.js / Worker) runtime.
 *
 * WHY THIS EXISTS (production-readiness audit, M-6)
 *   Failure paths logged free-form strings (`console.error("[realtime] publish
 *   failed", err)`), which cannot be counted, filtered or alerted on. This
 *   emits ONE JSON line per event with a stable `event` name plus a small,
 *   allow-listed metadata object.
 *
 * WHAT MUST NEVER BE LOGGED
 *   JWTs, session cookies, push tokens, message/content bodies, email
 *   addresses, or any other personal data. Callers pass ids and counts only.
 *
 * These lines go to the platform's existing log sink (Cloudflare Workers Logs /
 * Vercel) — no new logging infrastructure.
 *
 * Deliberately NOT marked `server-only`: the marker's package is not resolvable
 * by the `tsx --test` runner, and server-only modules that log (push, realtime)
 * must stay importable there. Nothing in this module touches request state or
 * secrets, so the marker added no safety.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  /** Stable, greppable event name, e.g. "realtime.publish.failed". */
  event: string;
  /** Safe ids/counts only — never tokens, cookies or message content. */
  [key: string]: unknown;
}

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
