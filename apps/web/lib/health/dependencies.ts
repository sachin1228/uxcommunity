/**
 * Reachability checks for every external service the product leans on.
 *
 * WHY THIS EXISTS
 *   On 2026-10-09 the R2 media credential was rejected and every upload route
 *   answered 500 while the rest of the app stayed green. Finding that took a
 *   log dive: the only trace was `Unauthorized: Unauthorized` from inside the
 *   AWS SDK, thrown from `uploadToR2` (apps/web/lib/r2.ts), and nothing in the
 *   product could answer "is storage up?" without a user trying an upload.
 *   `scripts/verify-r2-credentials.mjs` guards the deploy; the sibling guard
 *   scripts/verify-service-credentials.mjs covers the rest of the repository
 *   secrets; this module is the same question asked at runtime, for the admin
 *   page at apps/web/app/admin/(protected)/health/page.tsx and the monitor
 *   endpoint at apps/web/app/api/internal/dependency-health/route.ts.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *   Every probe is read-only or inert, so it can run every five minutes and on
 *   every page load without side effects:
 *   - R2: a one-object listing under the `healthcheck/` prefix. That proves the
 *     credential R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY is accepted and
 *     R2_BUCKET_NAME is reachable; it writes nothing. A full write probe lives
 *     in the deploy guard, which is the right place for it.
 *   - R2 (Next.js cache): the separate incremental-cache bucket is listed
 *     through its Worker binding and counted — objects, bytes, and the build
 *     prefixes they belong to. Listing is a read; the scan stops at a page cap
 *     so a bucket that has grown large cannot turn one page load into a walk of
 *     the whole thing. A process that is not a Worker has no binding to read,
 *     which is reported as nothing to check rather than as a fault: a local dev
 *     server is not a broken deploy.
 *   - Supabase: a `head: true, count: exact` count on `users` — no rows leave
 *     the database, and it exercises the service-role key every API route uses.
 *   - Realtime: a `/publish` request carrying an EMPTY event list. The Worker
 *     validates REALTIME_PUBLISH_SECRET first and then refuses the empty
 *     payload, so a healthy answer proves the Worker is up and the secret is
 *     accepted while nothing is delivered to any room. 403 is the mismatch that
 *     otherwise leaves sockets silently refused.
 *   - Upstash: `GET /ping` on the REST endpoint with the token — the same pair
 *     the rate limiter uses. It fails open by design (see lib/auth/rate-limit.ts),
 *     so this is the only way to learn the limiter has been off.
 *   - Resend: `GET /domains`, an authenticated read that proves RESEND_API_KEY
 *     without sending mail. A dead key here breaks password resets and welcome
 *     emails silently — nothing in the app surfaces it.
 *   - GIPHY: a one-result trending lookup with GIPHY_API_KEY.
 *
 * SEVERITY AND ALERTING
 *   Each check carries `severity` (can the app serve without it?) and `alerts`
 *   (should a `down` email an admin — see lib/health/alert.ts). The distinction
 *   is deliberate: Upstash failing open and a GIPHY key that only breaks GIF
 *   search must not page anyone at 3am, while a rejected Resend key that
 *   silently kills password resets must. The cache bucket is the same call for
 *   size instead of reachability: it serves either way, so it is reported and
 *   never alerted on.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { R2_CREDENTIAL_HINT, classifyR2Failure, getR2PublicBase, listR2ObjectKeys } from "@/lib/r2";
import { createServiceClient } from "@/lib/supabase/service";

/** How a dependency answered. `degraded` answered but is not trustworthy. */
export type DependencyStatus = "ok" | "degraded" | "down";

/** `critical` = the app cannot serve without it; `supporting` = a feature degrades. */
export type DependencySeverity = "critical" | "supporting";

export type DependencyId =
  | "r2"
  | "r2-cache"
  | "supabase"
  | "realtime"
  | "upstash"
  | "resend"
  | "giphy";

export interface DependencyCheck {
  /** Stable id for the UI and for anything scraping the endpoint. */
  id: DependencyId;
  label: string;
  status: DependencyStatus;
  severity: DependencySeverity;
  /** Whether a `down` status should email an admin. */
  alerts: boolean;
  latencyMs: number;
  /** One sentence an operator can act on. Never contains a secret value. */
  detail: string;
  /** What to fix, when there is something to fix. */
  hint?: string;
}

export interface DependencyReport {
  checkedAt: string;
  /** True when no CRITICAL dependency is unhealthy — the app cannot serve without these. */
  healthy: boolean;
  /** True when every dependency, critical or supporting, answered `ok`. */
  allOk: boolean;
  /** The unhealthy checks the monitor should page an admin about. */
  alerts: DependencyCheck[];
  checks: DependencyCheck[];
}

/** Nothing here may hang a page or a monitor: every probe is bounded. */
const PROBE_TIMEOUT_MS = 10_000;

/** Lists objects in the media bucket; injected so the branches are testable. */
export type R2Lister = (prefix: string) => Promise<{ objects: unknown[] }>;

/** Counts a row without transferring it; injected so the branches are testable. */
export type DatabaseProbe = () => Promise<void>;

type FetchLike = typeof fetch;

/** The prefix the deploy guard also probes, so leftovers are recognisable. */
export const HEALTHCHECK_PREFIX = "healthcheck/";

/**
 * The Worker binding OpenNext's R2 incremental cache reads and writes, declared
 * in apps/web/wrangler.toml. Named here because a check that cannot say which
 * binding is missing is not actionable.
 */
export const CACHE_BUCKET_BINDING = "NEXT_INC_CACHE_R2_BUCKET";

/**
 * Where the cache bucket stops looking healthy.
 *
 * A cache in steady state holds a few dozen distinct keys — the home feed, the
 * Lottie payloads, the master-data maps — which at today's entry size is a
 * couple of hundred megabytes. What makes the bucket grow without bound is
 * deploys: each one writes the same keys under a fresh build id, and nothing
 * expires the previous ones, so every deploy leaves a copy behind forever.
 *
 * Both lines sit an order of magnitude above what a healthy bucket looks like:
 * early enough to act on, late enough not to flag ordinary churn.
 */
export const CACHE_WARN_OBJECTS = 25_000;
export const CACHE_WARN_BYTES = 1024 ** 3;

/** Objects per listing page, and the cap on how many pages one check walks. */
const CACHE_PAGE_LIMIT = 1000;
export const CACHE_MAX_PAGES = 30;

/**
 * One page of a bucket listing, as the Worker binding answers it.
 *
 * A structural type rather than R2Bucket itself: only these fields are read, so
 * the scan can be exercised without a Worker binding (or a Cloudflare account)
 * anywhere near it.
 */
export interface CacheBucketPage {
  objects: Array<{ key: string; size: number; uploaded: number }>;
  truncated: boolean;
  cursor?: string;
}

/** Reads one page of the incremental-cache bucket. Injected in tests. */
export type CacheBucketLister = (cursor?: string) => Promise<CacheBucketPage>;

/**
 * The part of the Worker's bucket binding this module reads.
 *
 * Written out structurally rather than as the global bucket type: the binding
 * types come from `wrangler types`, which this repository does not commit, so
 * naming them would make the health module stop compiling on a fresh checkout.
 * The listing shape below is the whole surface the check touches.
 */
type CacheBucketBinding = {
  list(options: { limit?: number; cursor?: string }): Promise<CacheBucketListing>;
};

/** One page exactly as the binding answers it — the timestamp is a Date. */
type CacheBucketListing = {
  objects: Array<{ key: string; size: number; uploaded: Date }>;
  truncated: boolean;
  cursor?: string;
};

/** What a scan of the bucket adds up to. */
export interface CacheUsage {
  /** Cache entries the scan counted. */
  objectCount: number;
  totalBytes: number;
  /**
   * Entries grouped by the build id in their key, newest build first — the
   * shape growth takes here, and the reason a bucket of this size is worth
   * reporting at all.
   */
  builds: Array<{ buildId: string; objects: number; bytes: number; lastUploaded: number }>;
  /** True when the scan stopped at its page cap with objects still unread. */
  truncated: boolean;
}

/** Produces the usage summary a check reports. Injected in tests. */
export type CacheUsageScanner = () => Promise<CacheUsage>;

/**
 * Raised when a Worker is running without the incremental-cache binding.
 *
 * This is the fault case, and the only one worth a red card: the Worker is
 * deployed and should have the bucket, so a binding that is not attached means
 * the deploy did not finish or the bucket was removed underneath it.
 */
export class CacheBindingMissingError extends Error {
  constructor(cause?: unknown) {
    super(`No ${CACHE_BUCKET_BINDING} binding is attached to this Worker.`);
    this.name = "CacheBindingMissingError";
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Raised when this process has no Cloudflare context at all.
 *
 * The opposite of a fault: a local `next dev` server, a unit test and a build
 * step are all Node processes that never have Worker bindings, and there is
 * nothing for an operator to fix. Reported apart from
 * {@link CacheBindingMissingError} because rendering them the same way put a
 * permanent red card on every developer's System Health page.
 */
export class WorkerContextUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("This process is not a Cloudflare Worker, so it has no bindings to read.");
    this.name = "WorkerContextUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

interface CheckSpec {
  id: DependencyId;
  label: string;
  severity: DependencySeverity;
  alerts: boolean;
}

const SPECS: Record<DependencyId, CheckSpec> = {
  r2: { id: "r2", label: "Cloudflare R2 (media)", severity: "critical", alerts: true },
  // Support: the app serves without it. An unreadable binding costs latency
  // (the heavy caches are recomputed on every cold isolate), not correctness.
  "r2-cache": {
    id: "r2-cache",
    label: "Cloudflare R2 (Next.js cache)",
    severity: "supporting",
    alerts: false,
  },
  supabase: { id: "supabase", label: "Supabase (database)", severity: "critical", alerts: true },
  realtime: { id: "realtime", label: "Cloudflare realtime Worker", severity: "critical", alerts: true },
  // Fails open by design, so it degrades rate limiting rather than the app —
  // but it is also invisible, which is why it is checked at all.
  upstash: { id: "upstash", label: "Upstash Redis (rate limiting)", severity: "supporting", alerts: false },
  // Silent when dead: password resets and welcome emails just stop arriving.
  resend: { id: "resend", label: "Resend (transactional email)", severity: "critical", alerts: true },
  giphy: { id: "giphy", label: "GIPHY (GIF search)", severity: "supporting", alerts: false },
};

/** Every id this module checks, in the order the page shows them. */
export const DEPENDENCY_IDS = Object.keys(SPECS) as DependencyId[];

/**
 * The service-role query the database check runs. `head: true` keeps the row
 * out of the response: this asks whether the database answers, not for data.
 */
export async function probeDatabase(): Promise<void> {
  const { error } = await createServiceClient()
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message || "Supabase rejected the count query");
}

/** Times a probe and turns its outcome into one check result. */
async function runProbe(
  spec: CheckSpec,
  probe: () => Promise<{ detail: string; hint?: string; status?: DependencyStatus }>,
): Promise<DependencyCheck> {
  const startedAt = Date.now();
  const base = { id: spec.id, label: spec.label, severity: spec.severity, alerts: spec.alerts };
  try {
    const result = await probe();
    return {
      ...base,
      status: result.status ?? "ok",
      latencyMs: Date.now() - startedAt,
      detail: result.detail,
      ...(result.hint ? { hint: result.hint } : {}),
    };
  } catch (error) {
    return {
      ...base,
      status: "down",
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : "The check could not run.",
    };
  }
}

/** The lines every "rotate me" hint shares, so the wording cannot drift apart. */
const REPO_SECRET_HINT = "This is a repository secret — update it in GitHub (Settings → Secrets and variables → Actions) and redeploy.";

/**
 * Reads the media bucket through the same client every upload uses.
 *
 * A rejected credential reports the repair carried by the runtime error in
 * apps/web/lib/r2.ts, so this page says "rotate the key" and not "R2 is down".
 */
export async function checkR2Media(list: R2Lister = listR2ObjectKeys): Promise<DependencyCheck> {
  return runProbe(SPECS.r2, async () => {
    let publicBase: string;
    try {
      publicBase = getR2PublicBase();
    } catch {
      return {
        status: "down" as const,
        detail: "R2_PUBLIC_URL is not set, so uploads could not return a usable URL.",
        hint: `Set R2_PUBLIC_URL to the bucket's public domain (for example https://media.uxcommunity.in). ${REPO_SECRET_HINT}`,
      };
    }

    try {
      const { objects } = await list(HEALTHCHECK_PREFIX);
      return {
        detail: `Media bucket answered and serves from ${publicBase}${
          objects.length ? ` (${objects.length} probe object(s) pending cleanup)` : ""
        }.`,
      };
    } catch (error) {
      const failure = classifyR2Failure(error);
      if (failure.credential) {
        return {
          status: "down" as const,
          detail: `R2 rejected the media credential (${failure.code}${
            failure.status ? ` HTTP ${failure.status}` : ""
          }).`,
          hint: `${R2_CREDENTIAL_HINT} ${REPO_SECRET_HINT}`,
        };
      }
      return {
        status: "degraded" as const,
        detail: error instanceof Error ? error.message : "R2 did not answer.",
        hint: "Check the bucket name and the account id, then re-check.",
      };
    }
  });
}

/** The build id of a key this module could not attribute to one. */
const UNKNOWN_BUILD = "(unrecognised keys)";

/**
 * The build id segment of an incremental-cache key.
 *
 * OpenNext writes each entry as `<prefix>/<buildId>/<hash of the key>.<type>`,
 * so the second segment is the build that wrote it — the identifier a deploy
 * changes and the reason the bucket accumulates. Anything shallower is grouped
 * under one heading rather than dropped, so the counts always add up to what
 * the scan actually saw.
 */
function buildIdOf(key: string): string {
  const segments = key.split("/");
  return segments.length >= 3 ? segments[1] : UNKNOWN_BUILD;
}

/** Thousands separators without Intl, so the wording is identical everywhere. */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Bytes as an operator reads them, in the units the Cloudflare dashboard uses. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The Worker's bindings, or {@link WorkerContextUnavailableError} when this
 * process is not a Worker.
 *
 * The throw from the adapter is the discriminator: a context that exists but
 * lacks the binding is a deployment fault, while no context at all means the
 * question does not apply here.
 */
function cloudflareEnv(): CloudflareEnv {
  try {
    return getCloudflareContext().env;
  } catch (cause) {
    throw new WorkerContextUnavailableError(cause);
  }
}

/**
 * Resolves the incremental-cache bucket from the Worker's own bindings.
 *
 * Read-only entry point: the bucket is not public and the media credential is
 * scoped to the media bucket, so this binding is the only way to see what the
 * cache is holding.
 */
function resolveCacheBucket(): CacheBucketBinding {
  const env = cloudflareEnv();
  const bucket = env[CACHE_BUCKET_BINDING] as CacheBucketBinding | undefined;
  if (!bucket) throw new CacheBindingMissingError();
  return bucket;
}

/** Enumerates one page of the bucket through the binding. */
async function listCachePage(cursor?: string): Promise<CacheBucketPage> {
  const bucket = resolveCacheBucket();
  const page = await bucket.list({ limit: CACHE_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });

  return {
    objects: page.objects.map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded.getTime(),
    })),
    truncated: page.truncated,
    cursor: page.cursor,
  };
}

/**
 * Walks the bucket page by page and adds it up.
 *
 * Bounded on purpose: at most CACHE_MAX_PAGES listings per check, so the cost
 * stays a few hundred milliseconds and a handful of operations however large
 * the bucket gets. Reaching the cap is reported rather than hidden — a
 * truncated scan says so, and its numbers are lower bounds.
 *
 * Entries are grouped by build id because that is the only part of this bucket
 * that grows without limit: the key set is small and stable, and every deploy
 * writes it again under a new prefix.
 */
export async function scanCacheBucket(
  list: CacheBucketLister = listCachePage,
): Promise<CacheUsage> {
  const builds = new Map<string, { objects: number; bytes: number; lastUploaded: number }>();
  let objectCount = 0;
  let totalBytes = 0;
  let truncated = false;
  let cursor: string | undefined;

  for (let page = 0; page < CACHE_MAX_PAGES; page += 1) {
    const answer = await list(cursor);

    for (const object of answer.objects) {
      objectCount += 1;
      totalBytes += object.size;

      const buildId = buildIdOf(object.key);
      const build = builds.get(buildId) ?? { objects: 0, bytes: 0, lastUploaded: 0 };
      build.objects += 1;
      build.bytes += object.size;
      build.lastUploaded = Math.max(build.lastUploaded, object.uploaded);
      builds.set(buildId, build);
    }

    // A page that claims to be truncated without handing back a cursor would
    // loop forever: the cursor is what makes the next listing a continuation
    // rather than a repeat of this one.
    if (!answer.truncated || !answer.cursor) break;
    if (page === CACHE_MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    cursor = answer.cursor;
  }

  return {
    objectCount,
    totalBytes,
    builds: [...builds.entries()]
      .map(([buildId, build]) => ({ buildId, ...build }))
      .sort((left, right) => right.lastUploaded - left.lastUploaded),
    truncated,
  };
}

/**
 * Reports the size of the Next.js incremental cache bucket.
 *
 * Nothing in the product used to surface this bucket, which is how it can be
 * mistaken for junk in the Cloudflare dashboard and deleted: apps/web/wrangler.toml
 * binds it (NEXT_INC_CACHE_R2_BUCKET) and open-next.config.ts makes it the
 * backing store for the home feed, the Lottie payloads and the master-data
 * maps, so it is required, not leftover. It is also the one bucket here that
 * only ever grows — R2 has no TTL, every deploy adds a build prefix, and no
 * step prunes the previous ones — so the page states the numbers and flags the
 * shape, and repairs nothing.
 */
export async function checkR2Cache(
  scan: CacheUsageScanner = () => scanCacheBucket(),
): Promise<DependencyCheck> {
  return runProbe(SPECS["r2-cache"], async () => {
    let usage: CacheUsage;
    try {
      usage = await scan();
    } catch (error) {
      // Not a Worker: no binding exists to be missing, so there is nothing to
      // report and nothing to fix. Every other environment this runs in — the
      // admin page in a deploy, the monitor, a preview — is a Worker.
      if (error instanceof WorkerContextUnavailableError) {
        return {
          detail:
            "Not running on Cloudflare, so there is no cache bucket to read: bindings exist only in a " +
            "deploy or a preview, never in a local dev server.",
        };
      }
      if (error instanceof CacheBindingMissingError) {
        return {
          status: "down" as const,
          detail:
            "This Worker has no Next.js cache bucket attached, so the heavy caches live only in per-isolate memory.",
          hint:
            `${CACHE_BUCKET_BINDING} is declared in apps/web/wrangler.toml and created by the deploy — ` +
            "without it a cold isolate recomputes the home feed and the cached maps (0.8–1.8s each). " +
            "Redeploy so the binding is attached.",
        };
      }
      return {
        status: "degraded" as const,
        detail: `The cache bucket could not be listed: ${
          error instanceof Error ? error.message : "the listing failed"
        }`,
        hint: "Check that the bucket still exists in the Cloudflare account and that the binding survived the last deploy.",
      };
    }

    const newest = usage.builds[0];
    const olderBytes = usage.totalBytes - (newest?.bytes ?? 0);
    const over = usage.objectCount >= CACHE_WARN_OBJECTS || usage.totalBytes >= CACHE_WARN_BYTES;

    const detail = [
      `${groupThousands(usage.objectCount)} objects / ${formatBytes(usage.totalBytes)} across ${groupThousands(
        usage.builds.length,
      )} build ${usage.builds.length === 1 ? "prefix" : "prefixes"}.`,
      newest
        ? `The newest build holds ${groupThousands(newest.objects)} of them (${formatBytes(
            newest.bytes,
          )}); everything older holds ${formatBytes(olderBytes)}.`
        : "Nothing has been written to it yet.",
      usage.truncated
        ? `The scan stopped at its ${groupThousands(
            CACHE_MAX_PAGES * CACHE_PAGE_LIMIT,
          )}-object cap, so these numbers are lower bounds.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (!over) return { detail };

    return {
      status: "degraded" as const,
      detail,
      hint:
        `Past the ${groupThousands(CACHE_WARN_OBJECTS)}-object / ${formatBytes(CACHE_WARN_BYTES)} line. ` +
        "Nothing expires this bucket: each deploy leaves the previous build's entries behind, and only a " +
        "prefix that is no longer the current build can be deleted safely. Removing one costs the next " +
        "request its recompute and nothing else.",
    };
  });
}

/** Asks the database a question that returns no rows. */
export async function checkDatabase(probe: DatabaseProbe = probeDatabase): Promise<DependencyCheck> {
  return runProbe(SPECS.supabase, async () => {
    await probe();
    return { detail: "Service-role query answered." };
  });
}

/**
 * Proves the realtime Worker is up AND accepts this app's publish secret,
 * without delivering anything: the payload has no events, so the Worker
 * refuses it after the secret check.
 */
export async function checkRealtimeWorker(
  options: { url?: string; secret?: string; fetchImpl?: FetchLike } = {},
): Promise<DependencyCheck> {
  const url = options.url ?? process.env.REALTIME_URL ?? "";
  const secret = options.secret ?? process.env.REALTIME_PUBLISH_SECRET ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;

  return runProbe(SPECS.realtime, async () => {
    if (!url || !secret) {
      return {
        status: "down" as const,
        detail: "Realtime is not configured in this environment.",
        hint:
          "REALTIME_URL and REALTIME_PUBLISH_SECRET are absent. Previews omit them on purpose (they " +
          "must not publish to the production realtime service); production gets both from the deploy.",
      };
    }

    try {
      const response = await fetchImpl(`${url}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": secret,
        },
        // Empty on purpose — see the module comment. Nothing is delivered.
        body: JSON.stringify({ events: [] }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (response.status === 403) {
        return {
          status: "down" as const,
          detail: "The realtime Worker rejected this app's publish secret (403).",
          hint:
            "REALTIME_PUBLISH_SECRET must be identical in the web Worker and the realtime Worker; a " +
            "mismatch refuses every server-to-server event, so chat stops updating live.",
        };
      }
      if (response.status === 404) {
        return {
          status: "down" as const,
          detail: `No publish route answered at ${url}/publish (404).`,
          hint: "REALTIME_URL should be the realtime Worker's origin, with no trailing path.",
        };
      }
      if (response.status >= 500 || response.status === 429) {
        return {
          status: "degraded" as const,
          detail: `The realtime Worker answered ${response.status}.`,
          hint: "Live updates may be intermittent; the database stays the source of truth.",
        };
      }
      // 400 is the healthy answer: the secret was accepted and the empty probe
      // payload was refused. Any other 2xx/4xx means the secret got through.
      return { detail: "Worker accepted the publish secret and refused the empty probe payload." };
    } catch (error) {
      return {
        status: "down" as const,
        detail:
          error instanceof Error
            ? `The realtime Worker did not answer: ${error.message}`
            : "The realtime Worker did not answer.",
        hint: "Check that the worker is deployed and REALTIME_URL resolves.",
      };
    }
  });
}

/**
 * Pings the Upstash REST endpoint with the token the rate limiter uses.
 *
 * The limiter fails open (lib/auth/rate-limit.ts), which keeps the app up during
 * a Redis outage but also means a dead token silently disables every limit.
 */
export async function checkUpstash(
  options: { url?: string; token?: string; fetchImpl?: FetchLike } = {},
): Promise<DependencyCheck> {
  const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;

  return runProbe(SPECS.upstash, async () => {
    if (!url || !token) {
      return {
        status: "down" as const,
        detail: "Upstash is not configured, so rate limiting is off.",
        hint: `Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. ${REPO_SECRET_HINT}`,
      };
    }

    try {
      const response = await fetchImpl(`${url.replace(/\/$/, "")}/ping`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const body = await response.text().catch(() => "");

      if (response.status === 401 || response.status === 403) {
        return {
          status: "down" as const,
          detail: `Upstash rejected the REST token (HTTP ${response.status}).`,
          hint: `Rate limiting is allowing every request through until this is fixed — rotate UPSTASH_REDIS_REST_TOKEN (the URL rarely changes). ${REPO_SECRET_HINT}`,
        };
      }
      if (!response.ok) {
        return {
          status: "degraded" as const,
          detail: `Upstash answered HTTP ${response.status}.`,
          hint: "The limiter fails open, so requests are not being limited while this lasts.",
        };
      }
      return {
        detail: body.includes("PONG")
          ? "REST endpoint answered PONG."
          : "REST endpoint answered; rate limiting is enforced.",
      };
    } catch (error) {
      return {
        status: "down" as const,
        detail:
          error instanceof Error ? `Upstash did not answer: ${error.message}` : "Upstash did not answer.",
        hint: "The limiter fails open while Redis is unreachable.",
      };
    }
  });
}

/**
 * Authenticated read on Resend that proves RESEND_API_KEY without sending mail.
 *
 * Nothing in the app surfaces a dead email key: a password reset or welcome
 * email that never arrives looks exactly like a user who did not check their
 * inbox.
 */
export async function checkResend(
  options: { apiKey?: string; fetchImpl?: FetchLike } = {},
): Promise<DependencyCheck> {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;

  return runProbe(SPECS.resend, async () => {
    if (!apiKey) {
      return {
        status: "down" as const,
        detail: "Resend is not configured, so no email can be sent.",
        hint: `Set RESEND_API_KEY and EMAIL_FROM. ${REPO_SECRET_HINT}`,
      };
    }

    try {
      const response = await fetchImpl("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (response.status === 401 || response.status === 403) {
        return {
          status: "down" as const,
          detail: `Resend rejected the API key (HTTP ${response.status}).`,
          hint:
            `Password resets and welcome emails fail silently while this is broken. ${REPO_SECRET_HINT}`,
        };
      }
      if (!response.ok) {
        return {
          status: "degraded" as const,
          detail: `Resend answered HTTP ${response.status}.`,
          hint: "Email delivery may be failing; send a test reset to confirm.",
        };
      }
      return { detail: "Authenticated domain lookup answered." };
    } catch (error) {
      return {
        status: "down" as const,
        detail:
          error instanceof Error ? `Resend did not answer: ${error.message}` : "Resend did not answer.",
        hint: "Email features (password reset, welcome emails) fail while this lasts.",
      };
    }
  });
}

/** One-result trending lookup — the cheapest call that proves GIPHY_API_KEY. */
export async function checkGiphy(
  options: { apiKey?: string; fetchImpl?: FetchLike } = {},
): Promise<DependencyCheck> {
  const apiKey = options.apiKey ?? process.env.GIPHY_API_KEY ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;

  return runProbe(SPECS.giphy, async () => {
    if (!apiKey) {
      return {
        status: "down" as const,
        detail: "GIPHY is not configured, so GIF search is off.",
        hint: `Set GIPHY_API_KEY. ${REPO_SECRET_HINT}`,
      };
    }

    try {
      const response = await fetchImpl(
        `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=1`,
        { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
      );

      if (response.status === 401 || response.status === 403) {
        return {
          status: "down" as const,
          detail: `GIPHY rejected the API key (HTTP ${response.status}).`,
          hint: `GIF and sticker search will return errors. ${REPO_SECRET_HINT}`,
        };
      }
      if (!response.ok) {
        return {
          status: "degraded" as const,
          detail: `GIPHY answered HTTP ${response.status}.`,
          hint: "GIF search may be degraded; it is not on the critical path.",
        };
      }
      return { detail: "Trending lookup answered." };
    } catch (error) {
      return {
        status: "degraded" as const,
        detail:
          error instanceof Error ? `GIPHY did not answer: ${error.message}` : "GIPHY did not answer.",
        hint: "GIF search only; nothing else depends on this key.",
      };
    }
  });
}

export interface DependencyOverrides {
  r2?: R2Lister;
  "r2-cache"?: CacheUsageScanner;
  database?: DatabaseProbe;
  realtime?: { url?: string; secret?: string; fetchImpl?: FetchLike };
  upstash?: { url?: string; token?: string; fetchImpl?: FetchLike };
  resend?: { apiKey?: string; fetchImpl?: FetchLike };
  giphy?: { apiKey?: string; fetchImpl?: FetchLike };
}

/**
 * Runs every check in parallel and folds them into one report.
 *
 * Never throws: a check that explodes becomes a `down` entry, because the page
 * and the monitor must always be able to say WHICH dependency is unhealthy
 * rather than fail themselves. `healthy` tracks the critical set (what the app
 * cannot serve without), `allOk` tracks the supporting set as well, and
 * `alerts` lists the unhealthy checks a monitor should page about.
 */
export async function checkDependencies(overrides: DependencyOverrides = {}): Promise<DependencyReport> {
  const checks = await Promise.all([
    checkR2Media(overrides.r2),
    checkR2Cache(overrides["r2-cache"]),
    checkDatabase(overrides.database),
    checkRealtimeWorker(overrides.realtime),
    checkUpstash(overrides.upstash),
    checkResend(overrides.resend),
    checkGiphy(overrides.giphy),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    healthy: checks.every((check) => check.severity !== "critical" || check.status === "ok"),
    allOk: checks.every((check) => check.status === "ok"),
    alerts: checks.filter((check) => check.alerts && check.status === "down"),
    checks,
  };
}
