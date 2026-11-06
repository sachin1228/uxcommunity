import { assertServiceUrl } from "../../../packages/shared/src/environment";
import type { Env } from "./env";
import { logEvent } from "./log";

/**
 * Minute cron that drains the durable membership-revocation queue.
 *
 * The web app writes a queue row before deleting a membership and attempts the
 * immediate Room DO close after the delete. When that close fails (realtime
 * outage, timeout, 5xx), the row remains and this tick asks the web app to
 * retry it. The web app owns the database and the realtime secret; the Worker
 * only proves the scheduler is alive and carries the internal API secret.
 *
 * The web endpoint processes at most five rows with two short realtime
 * attempts each, well inside this 25 s deadline. A missed tick is harmless:
 * the rows stay due and the next tick picks them up.
 */

const PROCESS_TIMEOUT_MS = 25_000;

export interface MembershipRevocationRetryResult {
  ok: boolean;
  status?: number;
  summary?: unknown;
}

export async function runMembershipRevocationRetries(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<MembershipRevocationRetryResult> {
  if (!env.API_URL || !env.API_SECRET) {
    logEvent("error", {
      event: "realtime.membership_revocations.config_missing",
    });
    return { ok: false };
  }

  try {
    assertServiceUrl(env.API_URL, {
      APP_ENV: env.APP_ENV,
      STAGING_ALLOWED_ORIGINS: env.STAGING_ALLOWED_ORIGINS,
    });
  } catch (error) {
    logEvent("error", {
      event: "realtime.membership_revocations.invalid_api_url",
      error,
    });
    return { ok: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROCESS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${env.API_URL.replace(/\/+$/, "")}/api/internal/membership-revocations/process`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.API_SECRET}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      logEvent("warn", {
        event: "realtime.membership_revocations.drain_failed",
        status: response.status,
      });
      return { ok: false, status: response.status };
    }

    const summary = await response.json().catch(() => null);
    return { ok: true, status: response.status, summary };
  } catch (error) {
    logEvent("error", {
      event: "realtime.membership_revocations.drain_error",
      error,
    });
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
