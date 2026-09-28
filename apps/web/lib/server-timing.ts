import { logEvent } from "@/lib/observability/log";

type TimingDetails = Record<string, number>

const encoder = new TextEncoder()
const round = (value: number) => Math.round(value * 100) / 100

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
 *   1. emits ONE structured `api.timing` log line (stable event name, safe
 *      fields only — label, phase durations, total, status, counts), so slow
 *      routes are visible in the existing log sink; and
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
     * the `api.timing` log line exactly once per timer.
     */
    finish(extra: TimingDetails = {}): string {
      if (finished) return toServerTiming()
      finished = true

      Object.assign(details, extra)
      details.total = round(performance.now() - startedAt)

      const { status, ...phases } = details
      logEvent("info", {
        event: "api.timing",
        route: label,
        status,
        total_ms: details.total,
        phases,
      })

      return toServerTiming()
    },
  }
}
