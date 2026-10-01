import assert from "node:assert/strict"
import test from "node:test"

import { createServerTimer, SLOW_REQUEST_THRESHOLD_MS } from "./server-timing"

/** Capture `logEvent("info")` output (console.log) and restore it. */
function captureInfo(run: () => void): string[] {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "))
  }
  try {
    run()
  } finally {
    console.log = original
  }
  return lines
}

/** Replace `performance.now` with a settable clock and restore it afterwards. */
function stubClock() {
  const original = performance.now
  let now = 0
  Object.defineProperty(performance, "now", {
    value: () => now,
    writable: true,
    configurable: true,
  })
  return {
    set(value: number) {
      now = value
    },
    restore() {
      Object.defineProperty(performance, "now", {
        value: original,
        writable: true,
        configurable: true,
      })
    },
  }
}

test("a fast successful request emits no api.timing log", () => {
  const clock = stubClock()
  try {
    clock.set(0)
    const timer = createServerTimer("GET /api/home/feed")
    clock.set(10)
    let header = ""
    const lines = captureInfo(() => {
      header = timer.finish({ status: 200 })
    })

    assert.equal(lines.length, 0)
    // The header keeps every recorded field (including status); only the log line is gated.
    assert.equal(header, "total;dur=10, status;dur=200")
  } finally {
    clock.restore()
  }
})

test("a failed request logs timing with the fields needed to diagnose it", () => {
  const clock = stubClock()
  try {
    clock.set(0)
    const timer = createServerTimer("POST /api/communities/[id]/messages")
    timer.record("db_ms", 5)
    clock.set(15)
    const lines = captureInfo(() => {
      timer.finish({ status: 500, query_count: 2 })
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0]) as {
      event: string
      level: string
      route: string
      status: number
      total_ms: number
      phases: Record<string, number>
    }
    assert.equal(parsed.event, "api.timing")
    assert.equal(parsed.level, "info")
    assert.equal(parsed.route, "POST /api/communities/[id]/messages")
    assert.equal(parsed.status, 500)
    assert.equal(parsed.total_ms, 15)
    assert.equal(parsed.phases.db_ms, 5)
    assert.equal(parsed.phases.query_count, 2)
  } finally {
    clock.restore()
  }
})

test("a slow successful request logs even without a failure status", () => {
  const clock = stubClock()
  try {
    clock.set(0)
    const timer = createServerTimer("GET /api/profile/feed")
    clock.set(SLOW_REQUEST_THRESHOLD_MS + 1)
    const lines = captureInfo(() => {
      timer.finish({ status: 200 })
    })

    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0]) as { total_ms: number; status: number }
    assert.equal(parsed.total_ms, SLOW_REQUEST_THRESHOLD_MS + 1)
    assert.equal(parsed.status, 200)
  } finally {
    clock.restore()
  }
})

test("finish() logs at most once per timer", () => {
  const clock = stubClock()
  try {
    clock.set(0)
    const timer = createServerTimer("GET /api/communities/all")
    clock.set(20)
    const lines = captureInfo(() => {
      timer.finish({ status: 503 })
      timer.finish({ status: 503 })
    })

    assert.equal(lines.length, 1)
  } finally {
    clock.restore()
  }
})
