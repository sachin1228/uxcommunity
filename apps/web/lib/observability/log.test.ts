import assert from "node:assert/strict"
import test from "node:test"

import { logEvent } from "./log"

/** Capture the console method a level maps to, then restore it. */
function capture(level: "log" | "warn" | "error", run: () => void): string[] {
  const lines: string[] = []
  const original = console[level]
  console[level] = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
  try {
    run()
  } finally {
    console[level] = original
  }
  return lines
}

test("emits one JSON line with a stable event name and safe metadata", () => {
  const lines = capture("error", () => {
    logEvent("error", { event: "realtime.publish.failed", status: 503, events: 2 })
  })

  assert.equal(lines.length, 1)
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>
  assert.equal(parsed.event, "realtime.publish.failed")
  assert.equal(parsed.level, "error")
  assert.equal(parsed.status, 503)
  assert.equal(parsed.events, 2)
  assert.equal(typeof parsed.ts, "string")
})

test("reduces an Error to name and message, never a stack", () => {
  const lines = capture("error", () => {
    logEvent("error", { event: "x.y", error: new Error("boom") })
  })
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>

  assert.equal(parsed.error_name, "Error")
  assert.equal(parsed.error_message, "boom")
  assert.ok(!("error" in parsed), "the raw error object is not serialized")
  assert.ok(!JSON.stringify(parsed).includes("at "), "no stack frames leak")
})

test("handles non-Error error values without throwing", () => {
  const lines = capture("error", () => {
    logEvent("error", { event: "x.y", error: "just a string" })
  })
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>

  assert.equal(parsed.error_name, "Error")
  assert.equal(parsed.error_message, "just a string")
})

test("warn and info go to their own console methods", () => {
  const warnings = capture("warn", () => logEvent("warn", { event: "w" }))
  const infos = capture("log", () => logEvent("info", { event: "i" }))

  assert.equal(JSON.parse(warnings[0]).level, "warn")
  assert.equal(JSON.parse(infos[0]).level, "info")
})
