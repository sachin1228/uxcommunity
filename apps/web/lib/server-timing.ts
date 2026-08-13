type TimingDetails = Record<string, number>

export function createServerTimer(label: string) {
  const startedAt = performance.now()
  let checkpointAt = startedAt
  const details: TimingDetails = {}

  return {
    checkpoint(name: string) {
      const now = performance.now()
      details[name] = Math.round((now - checkpointAt) * 100) / 100
      checkpointAt = now
    },
    finish() {
      if (process.env.NODE_ENV !== "development") return

      details.total = Math.round((performance.now() - startedAt) * 100) / 100
      console.debug(`[server-timing] ${label}`, details)
    },
  }
}
