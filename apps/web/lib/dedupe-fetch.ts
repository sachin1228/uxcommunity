/**
 * Global in-flight request deduplication (the "request manager").
 *
 * When the same request — method + normalized URL + body — is already in
 * flight, every concurrent caller receives the SAME promise instead of
 * starting a second network request:
 *
 *   click 1 → fetch()                 (network request)
 *   click 2 → join promise from click 1
 *   click 3 → join promise from click 1
 *   ...
 *
 * After a request settles *successfully*, identical calls inside a short
 * window reuse the settled promise, so a rapid burst of clicks on the same
 * button collapses into one request even if the network was fast.
 *
 * Failures clear the lock immediately — the caller can retry right away and
 * is never blocked by a stale in-flight entry.
 *
 * Bodies that cannot be compared safely (FormData, Blob, streams) bypass
 * deduplication entirely so unrelated uploads never collide.
 */
const DEFAULT_SETTLE_WINDOW_MS = 750

type SettledEntry = {
  promise: Promise<Response>
  settledAt: number
}

/** method → normalized url → body key → in-flight request */
const inFlight = new Map<string, Promise<Response>>()
/** method → normalized url → body key → recently settled request */
const settled = new Map<string, SettledEntry>()

let telemetry = { deduped: 0, replayed: 0, bypassed: 0 }

export function getDedupeFetchTelemetry() {
  return { ...telemetry }
}

function devLog(key: string, source: "dedup" | "replay" | "miss") {
  if (process.env.NODE_ENV !== "development") return
  console.debug(`[dedupe-fetch] ${source} ${key}`)
}

function normalizeUrl(input: RequestInfo | URL): string {
  try {
    const url = new URL(String(input), "http://uxcommunity.local")
    url.hash = ""
    url.searchParams.sort()
    return `${url.pathname}${url.search}`
  } catch {
    return String(input)
  }
}

/** Returns the request-key body fragment, or null when the body can't be compared. */
function bodyKey(body: BodyInit | null | undefined): string | null {
  if (body == null) return ""
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  // FormData, Blob, ArrayBuffer and streams carry opaque content that cannot
  // be compared — never dedupe these (two uploads would collide).
  return null
}

export type DedupeFetchOptions = {
  /** Replay a successfully settled identical request within this window. Default 750 ms. */
  settleWindowMs?: number
}

/**
 * fetch() wrapper that shares in-flight requests with identical method, URL
 * and body, and replays successful results for a short window after settle.
 */
export function dedupeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: DedupeFetchOptions = {},
): Promise<Response> {
  const body = bodyKey(init?.body)
  if (body === null) {
    telemetry.bypassed += 1
    return fetch(input, init)
  }

  const method = (init?.method ?? "GET").toUpperCase()
  const key = `${method} ${normalizeUrl(input)} ${body}`

  const pending = inFlight.get(key)
  if (pending) {
    telemetry.deduped += 1
    devLog(key, "dedup")
    return pending
  }

  const settleWindowMs = options.settleWindowMs ?? DEFAULT_SETTLE_WINDOW_MS
  const last = settled.get(key)
  if (last && Date.now() - last.settledAt < settleWindowMs) {
    telemetry.replayed += 1
    devLog(key, "replay")
    return last.promise
  }

  devLog(key, "miss")
  const raw = fetch(input, init)
  let request: Promise<Response>
  request = raw.then(
    (response) => {
      // Only successful requests are replayed. Failures must clear the lock so
      // the user can retry immediately (and get a fresh network attempt).
      if (response.ok) {
        settled.set(key, { promise: request, settledAt: Date.now() })
      } else {
        settled.delete(key)
      }
      return response
    },
    (error: unknown) => {
      settled.delete(key)
      throw error
    },
  )

  inFlight.set(key, request)
  void request.finally(() => inFlight.delete(key)).catch(() => undefined)
  return request
}

/** Test hook — forgets every in-flight and settled request. */
export function clearDedupeCache() {
  inFlight.clear()
  settled.clear()
  telemetry = { deduped: 0, replayed: 0, bypassed: 0 }
}
