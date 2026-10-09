/**
 * Reachability checks for the three external systems the app cannot serve
 * without: Cloudflare R2 (every uploaded image/video/audio), Supabase
 * (every read and write) and the realtime Worker (chat/typing/presence).
 *
 * WHY THIS EXISTS
 *   On 2026-10-09 the R2 media credential was rejected and every upload route
 *   answered 500 while the rest of the app stayed green. Finding that took a
 *   log dive: the only trace was `Unauthorized: Unauthorized` from inside the
 *   AWS SDK, thrown from `uploadToR2` (apps/web/lib/r2.ts), and nothing in the
 *   product could answer "is storage up?" without a user trying an upload.
 *   `scripts/verify-r2-credentials.mjs` now guards the deploy; this module is
 *   the same question asked at runtime, for the admin page at
 *   apps/web/app/admin/(protected)/health.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *   Each check is read-only or inert, so an admin can leave the page open and
 *   re-check without side effects:
 *   - R2: a one-object listing under the `healthcheck/` prefix. That proves the
 *     credential R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY is accepted and
 *     R2_BUCKET_NAME is reachable; it writes nothing. A full write probe lives
 *     in the deploy guard, which is the right place for it.
 *   - Supabase: a `head: true, count: exact` count on `users` — no rows leave
 *     the database, and it exercises the service-role key every API route uses.
 *   - Realtime: a `/publish` request carrying an EMPTY event list. The Worker
 *     validates the publish secret first and then refuses the empty payload, so
 *     a healthy answer (400) proves the Worker is up and REALTIME_URL /
 *     REALTIME_PUBLISH_SECRET are accepted — and, because the event list is
 *     empty, nothing is delivered to any room. 403 means the secret is wrong,
 *     which is the failure that used to leave sockets silently refused.
 *
 *   Every result carries the same status vocabulary and a `hint` naming the
 *   value to fix, mirroring the deploy guards, so the page is actionable rather
 *   than merely red.
 */

import { R2_CREDENTIAL_HINT, classifyR2Failure, getR2PublicBase, listR2ObjectKeys } from "@/lib/r2";
import { createServiceClient } from "@/lib/supabase/service";

/** How a dependency answered. `degraded` answered but is not trustworthy. */
export type DependencyStatus = "ok" | "degraded" | "down";

export interface DependencyCheck {
  /** Stable id for the UI and for anything scraping the endpoint. */
  id: "r2" | "supabase" | "realtime";
  label: string;
  status: DependencyStatus;
  latencyMs: number;
  /** One sentence an operator can act on. Never contains a secret value. */
  detail: string;
  /** What to fix, when there is something to fix. */
  hint?: string;
}

export interface DependencyReport {
  checkedAt: string;
  /** True only when every dependency answered `ok`. */
  healthy: boolean;
  checks: DependencyCheck[];
}

/** Nothing here may hang a page: every probe is bounded. */
const PROBE_TIMEOUT_MS = 10_000;

/** Lists objects in the media bucket; injected so the branches are testable. */
export type R2Lister = (prefix: string) => Promise<{ objects: unknown[] }>;

/** Counts a row without transferring it; injected so the branches are testable. */
export type DatabaseProbe = () => Promise<void>;

/** The prefix the deploy guard also probes, so leftovers are recognisable. */
export const HEALTHCHECK_PREFIX = "healthcheck/";

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
  id: DependencyCheck["id"],
  label: string,
  probe: () => Promise<{ detail: string; hint?: string; status?: DependencyStatus }>,
): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    const result = await probe();
    return {
      id,
      label,
      status: result.status ?? "ok",
      latencyMs: Date.now() - startedAt,
      detail: result.detail,
      ...(result.hint ? { hint: result.hint } : {}),
    };
  } catch (error) {
    return {
      id,
      label,
      status: "down",
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : "The check could not run.",
    };
  }
}

/**
 * Reads the media bucket through the same client every upload uses.
 *
 * A rejected credential reports the repair carried by the runtime error in
 * apps/web/lib/r2.ts, so this page says "rotate the key" and not "R2 is down".
 */
export async function checkR2Media(list: R2Lister = listR2ObjectKeys): Promise<DependencyCheck> {
  return runProbe("r2", "Cloudflare R2 (media)", async () => {
    let publicBase: string;
    try {
      publicBase = getR2PublicBase();
    } catch {
      return {
        status: "down" as const,
        detail: "R2_PUBLIC_URL is not set, so uploads could not return a usable URL.",
        hint: "Set R2_PUBLIC_URL to the bucket's public domain (for example https://media.uxcommunity.in).",
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
          hint: R2_CREDENTIAL_HINT,
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

/** Asks the database a question that returns no rows. */
export async function checkDatabase(probe: DatabaseProbe = probeDatabase): Promise<DependencyCheck> {
  return runProbe("supabase", "Supabase (database)", async () => {
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
  options: { url?: string; secret?: string; fetchImpl?: typeof fetch } = {},
): Promise<DependencyCheck> {
  const url = options.url ?? process.env.REALTIME_URL ?? "";
  const secret = options.secret ?? process.env.REALTIME_PUBLISH_SECRET ?? "";
  const fetchImpl = options.fetchImpl ?? fetch;

  return runProbe("realtime", "Cloudflare realtime Worker", async () => {
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
 * Runs every check in parallel and folds them into one report.
 *
 * Returns a report even when a check throws — the page must always be able to
 * say which dependency is unhealthy, never just fail itself. The overrides
 * exist so the aggregation can be exercised without touching a real service.
 */
export async function checkDependencies(
  overrides: {
    r2?: R2Lister;
    database?: DatabaseProbe;
    realtime?: { url?: string; secret?: string; fetchImpl?: typeof fetch };
  } = {},
): Promise<DependencyReport> {
  const checks = await Promise.all([
    checkR2Media(overrides.r2),
    checkDatabase(overrides.database),
    checkRealtimeWorker(overrides.realtime),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    healthy: checks.every((check) => check.status === "ok"),
    checks,
  };
}
