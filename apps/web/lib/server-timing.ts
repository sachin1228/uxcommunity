import { logEvent } from "@/lib/observability/log";

type TimingDetails = Record<string, number>

const encoder = new TextEncoder()
const round = (value: number) => Math.round(value * 100) / 100

/**
 * Successful requests faster than this emit no `api.timing` line: per-request
 * success logging is pure volume at scale. Failures (status >= 400) always log,
 * and slow requests log regardless of status. Tune in one place only.
 */
export const SLOW_REQUEST_THRESHOLD_MS = 500

export function estimateJsonBytes(value: unknown) {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength
  } catch {
    return 0
  }
}

/**
 * Per-request phase timer.
 *
 * Production-readiness audit (M-5): `finish()` used to store the collected
 * phase durations on an object that no code path ever read, so the routes were
 * "measured" invisibly. It now does two things with the same data:
 *
 *   1. emits at most ONE structured `api.timing` log line (stable event name,
 *      safe fields only — label, phase durations, total, status, counts) for
 *      requests that failed or ran slow, so those are visible in the existing
 *      log sink without logging every successful request; and
 *   2. returns the value for an HTTP `Server-Timing` header, so callers that
 *      want to surface the timings to the browser can attach it with
 *      `response.headers.set("Server-Timing", timing)`.
 */
export function createServerTimer(label: string) {
  const startedAt = performance.now()
  let checkpointAt = startedAt
  const details: TimingDetails = {}
  let finished = false

  /** `name;dur=1.23` pairs, `total` first so a tailer sees the headline number. */
  const toServerTiming = (): string => {
    const parts: string[] = [`total;dur=${details.total ?? round(performance.now() - startedAt)}`]
    for (const [name, value] of Object.entries(details)) {
      if (name === "total") continue
      parts.push(`${name};dur=${value}`)
    }
    return parts.join(", ")
  }

  return {
    checkpoint(name: string) {
      const now = performance.now()
      details[name] = round(now - checkpointAt)
      checkpointAt = now
    },
    async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const operationStartedAt = performance.now()
      try {
        return await operation()
      } finally {
        details[name] = round(performance.now() - operationStartedAt)
      }
    },
    record(name: string, value: number) {
      details[name] = round(value)
    },
    /**
     * Finalize the timer. Returns the `Server-Timing` header value and emits
     * at most one `api.timing` log line per timer — only for failed or slow
     * requests. Routine successes stay silent.
     */
    finish(extra: TimingDetails = {}): string {
      if (finished) return toServerTiming()
      finished = true

      Object.assign(details, extra)
      details.total = round(performance.now() - startedAt)

      const { status, ...phases } = details
      const failed = typeof status === "number" && status >= 400
      const slow = details.total > SLOW_REQUEST_THRESHOLD_MS
      if (failed || slow) {
        logEvent("info", {
          event: "api.timing",
          route: label,
          status,
          total_ms: details.total,
          phases,
        })
      }

      return toServerTiming()
    },
  }
}
