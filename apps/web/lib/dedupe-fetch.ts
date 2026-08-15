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
 * window reuse the settled result, so a rapid burst of clicks on the same
 * button collapses into one request even if the network was fast.
 *
 * Failures clear every lock immediately — the caller can retry right away
 * and is never blocked by a stale entry.
 *
 * Two replay strategies:
 *   - `exact` (default): replays only byte-identical requests (same body).
 *     Safe for every caller (e.g. chat send — two different messages to the
 *     same endpoint must not collide).
 *   - `url` (mutations like like/save/follow): replays ANY recent request to
 *     the same method + URL regardless of body. Toggle buttons fire
 *     alternating bodies (`{"saved":true}` → `{"saved":false}`), which would
 *     otherwise never dedupe — 20 rapid clicks would produce many requests.
 *     With `url` mode a burst collapses to one network request.
 *
 * Bodies that cannot be compared safely (FormData, Blob, streams) bypass
 * deduplication entirely so unrelated uploads never collide.
 */
const DEFAULT_SETTLE_WINDOW_MS = 750
const DEFAULT_MUTATION_COOLDOWN_MS = 600

type BufferedResponse = {
  status: number
  statusText: string
  headers: [string, string][]
  bodyText: string
}

type SettledEntry = {
  buffered: BufferedResponse
  settledAt: number
}

/** method → normalized url → body key → in-flight request (resolves to buffered body) */
const inFlight = new Map<string, Promise<BufferedResponse>>()
/** method → normalized url → body key → recently settled (exact) request */
const settled = new Map<string, SettledEntry>()
/** method → normalized url → recently settled mutation (url mode) */
const urlSettled = new Map<string, SettledEntry>()

let telemetry = { new: 0, deduped: 0, replayed: 0, bypassed: 0 }

export function getDedupeFetchTelemetry() {
  return { ...telemetry }
}

/**
 * fetch() used for the actual network call.
 *
 * Defaults to a lazy read of the global fetch so tests can stub it. Once
 * `installGlobalFetchGuard` patches `window.fetch`, it pins this to the
 * pre-patch global fetch — otherwise a patched `window.fetch` would call back
 * into `dedupeFetch` and recurse infinitely.
 */
let fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)

export function setDedupeFetchImpl(impl: typeof fetch) {
  fetchImpl = impl
}

export function resetDedupeFetchImpl() {
  fetchImpl = (input, init) => globalThis.fetch(input, init)
}

function devLog(key: string, source: "new" | "dedup" | "replay" | "removed" | "bypass") {
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

/** Fresh Response for a replay caller — each caller gets its own readable body. */
function reconstructResponse(buffered: BufferedResponse): Response {
  return new Response(buffered.bodyText, {
    status: buffered.status,
    statusText: buffered.statusText,
    headers: buffered.headers,
  })
}

export type DedupeFetchOptions = {
  /**
   * Replay an exactly-identical (method + URL + body) settled request within
   * this window. Default 750 ms.
   */
  settleWindowMs?: number
  /**
   * `exact` (default) keys replay by method + URL + body.
   * `url` keys replay by method + URL only — intended for toggle mutations
   * (like/save/follow) whose bodies alternate, so a click burst collapses to
   * one network request.
   */
  cooldownMode?: "exact" | "url"
  /** Window for `url`-mode replay. Default 600 ms. */
  mutationCooldownMs?: number
}

/**
 * fetch() wrapper that shares in-flight requests and replays recently
 * settled results, so rapid repeated clicks produce a single request.
 */
export function dedupeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: DedupeFetchOptions = {},
): Promise<Response> {
  const body = bodyKey(init?.body)
  if (body === null) {
    telemetry.bypassed += 1
    devLog("", "bypass")
    return fetchImpl(input, init)
  }

  const method = (init?.method ?? "GET").toUpperCase()
  const url = normalizeUrl(input)
  const key = `${method} ${url} ${body}`
  const urlKey = `${method} ${url}`

  // 1) An identical request is already in flight — join it. Every caller gets
  //    its own freshly reconstructed Response so no two readers share a body.
  const pending = inFlight.get(key)
  if (pending) {
    telemetry.deduped += 1
    devLog(key, "dedup")
    return pending.then((buffered) => reconstructResponse(buffered))
  }

  const settleWindowMs = options.settleWindowMs ?? DEFAULT_SETTLE_WINDOW_MS
  const now = Date.now()

  // 2) An identical request settled recently — replay a FRESH response built
  //    from the buffered body (the original response's stream is already
  //    consumed by its first reader, so callers can never share it).
  const last = settled.get(key)
  if (last && now - last.settledAt < settleWindowMs) {
    telemetry.replayed += 1
    devLog(key, "replay")
    return Promise.resolve(reconstructResponse(last.buffered))
  }

  // 3) Toggle mutations: ANY recent request to this method + URL settles the
  //    burst, regardless of body (saved:true / saved:false both count as one).
  if (options.cooldownMode === "url") {
    const urlLast = urlSettled.get(urlKey)
    const cooldownMs = options.mutationCooldownMs ?? DEFAULT_MUTATION_COOLDOWN_MS
    if (urlLast && now - urlLast.settledAt < cooldownMs) {
      telemetry.replayed += 1
      devLog(`${urlKey} *`, "replay")
      return Promise.resolve(reconstructResponse(urlLast.buffered))
    }
  }

  // 4) Nothing to reuse — start a new network request. The body is buffered
  //    once (response.text()) and every caller — the first, concurrent joiners
  //    and settle-window replays — receives a fresh Response built from that
  //    buffer, so response bodies are never shared between readers.
  telemetry.new += 1
  devLog(key, "new")
  const raw = fetchImpl(input, init)
  const request = raw.then(
    async (response) => {
      const bodyText = await response.text()
      const buffered: BufferedResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        bodyText,
      }
      if (response.ok) {
        // Successful requests are replayed; failures are NOT (a retry must
        // always hit the network).
        const entry: SettledEntry = { buffered, settledAt: Date.now() }
        settled.set(key, entry)
        if (options.cooldownMode === "url") urlSettled.set(urlKey, entry)
      } else {
        settled.delete(key)
        urlSettled.delete(urlKey)
      }
      return buffered
    },
    (error: unknown) => {
      settled.delete(key)
      urlSettled.delete(urlKey)
      throw error
    },
  )

  inFlight.set(key, request)
  void request
    .finally(() => {
      inFlight.delete(key)
      devLog(key, "removed")
    })
    .catch(() => undefined)
  return request.then((buffered) => reconstructResponse(buffered))
}

/** Test hook — forgets every in-flight and settled request. */
export function clearDedupeCache() {
  inFlight.clear()
  settled.clear()
  urlSettled.clear()
  telemetry = { new: 0, deduped: 0, replayed: 0, bypassed: 0 }
}

