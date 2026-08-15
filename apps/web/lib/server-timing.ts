type TimingDetails = Record<string, number>

const encoder = new TextEncoder()
const round = (value: number) => Math.round(value * 100) / 100

/**
 * In development, only print the [server-timing] log for requests that exceed
 * this duration. Fast requests otherwise spam the dev terminal; slow ones still
 * surface so perf regressions stay visible. Production telemetry is unaffected.
 */
const DEV_LOG_THRESHOLD_MS = 250

export function estimateJsonBytes(value: unknown) {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength
  } catch {
    return 0
  }
}

export function createServerTimer(label: string) {
  const startedAt = performance.now()
  let checkpointAt = startedAt
  const details: TimingDetails = {}
  let finished = false

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
    finish(extra: TimingDetails = {}) {
      if (finished) return
      finished = true

      Object.assign(details, extra)
      details.total = round(performance.now() - startedAt)

      if (process.env.NODE_ENV === "development") {
        if (details.total >= DEV_LOG_THRESHOLD_MS) {
          console.debug(`[server-timing] ${label}`, details)
        }
        return
      }

      if (process.env.NODE_ENV === "production") {
        console.info(JSON.stringify({
          event: "performance.server",
          route: label,
          metrics: details,
        }))
      }
    },
  }
}
