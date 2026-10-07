/**
 * App-wide connectivity state.
 *
 * Sits between the OS signal (`navigator.onLine` plus the browser's `offline`
 * / `online` events) and the UI: `OfflineScreen` renders a full-page takeover
 * while offline, and the global fetch guard reports failed same-origin
 * requests so a dropped connection is still noticed if no event fires.
 *
 * Note what "online" does NOT mean here: the OS interface being up is not the
 * app server being reachable (and in local dev the app server answers even
 * with no internet at all). Callers confirm recovery with
 * `probeConnectivity()` before trusting it.
 *
 * Development-only console filter: while offline, `console.error` calls whose
 * payload is a network failure ("Failed to fetch", "network error", ...) are
 * downgraded to `console.debug`. Those are the expected symptom of the outage
 * — every poll and realtime catch-up repeats them — and at that volume they
 * bury anything real in the Next.js dev overlay. Everything else, and every
 * log while online, passes through untouched.
 */
type Listener = () => void

const listeners = new Set<Listener>()
let offline = false
/**
 * Once true, never resets. "Offline" can flip back the moment the OS
 * interface comes up, but that does not mean the app server is reachable
 * again — the offline takeover stays latched until a probe succeeds.
 */
let everOffline = false
let installed = false

function emit() {
  for (const listener of listeners) listener()
}

export function getOffline(): boolean {
  return offline
}

export function getEverOffline(): boolean {
  return everOffline
}

export function subscribeToConnectivity(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setOffline(next: boolean) {
  if (offline === next) return
  offline = next
  if (next) everOffline = true
  emit()
}

/**
 * Flags the app offline when a request fails while the OS already reports the
 * network down. Guarded on `navigator.onLine` so a transient failure over a
 * healthy connection (dev-server restart, one-off blip) cannot latch the
 * offline screen. Deliberate cancellations are not failures.
 */
export function reportNetworkFailure(error: unknown) {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") {
    return
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setOffline(true)
  }
}

/** One no-store check that the app server is actually reachable. */
export async function probeConnectivity(timeoutMs = 4000): Promise<boolean> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false
  if (!navigator.onLine) return false
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch("/api/healthz", {
      cache: "no-store",
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

const NETWORK_FAILURE_PATTERN =
  /(failed to fetch|network\s?error|load failed|fetch failed|net::err|err_(?:internet|connection|network)|request failed \(5\d\d\))/i

function looksLikeNetworkFailure(value: unknown): boolean {
  if (typeof value === "string") return NETWORK_FAILURE_PATTERN.test(value)
  if (value instanceof Error) {
    return value.name === "NetworkError" || NETWORK_FAILURE_PATTERN.test(value.message)
  }
  return false
}

function installDevConsoleFilter() {
  const original = console.error
  console.error = (...args: unknown[]) => {
    if (offline && args.some(looksLikeNetworkFailure)) {
      console.debug("[connectivity] suppressed while offline:", ...args)
      return
    }
    original(...args)
  }
}

function install() {
  if (installed || typeof window === "undefined") return
  installed = true
  offline = typeof navigator !== "undefined" && navigator.onLine === false
  if (offline) everOffline = true
  window.addEventListener("offline", () => setOffline(true))
  window.addEventListener("online", () => setOffline(false))
  if (process.env.NODE_ENV !== "production") installDevConsoleFilter()
}

install()
