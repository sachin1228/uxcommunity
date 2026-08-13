type TimingDetails = Record<string, number>

export function createServerTimer(label: string) {
  const startedAt = performance.now()
  let checkpointAt = startedAt
  const details: TimingDetails = {}

  const round = (value: number) => Math.round(value * 100) / 100

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
      if (process.env.NODE_ENV !== "development") return

      Object.assign(details, extra)
      details.total = round(performance.now() - startedAt)
      console.debug(`[server-timing] ${label}`, details)
    },
  }
}
