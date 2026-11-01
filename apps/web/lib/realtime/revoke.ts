import { assertServiceUrl } from "@uxcommunity/shared";
import { logEvent } from "@/lib/observability/log";

const REQUEST_TIMEOUT_MS = 1_200;
const ATTEMPTS = 2;

export interface RealtimeRevocation {
  userId?: string;
  /** Revoke exactly this socket. */
  sid?: string;
  /** Revoke every socket except this one (password change keeps the current device). */
  exceptSid?: string;
  /** Revoke every socket for the user. */
  all?: boolean;
}

function realtimeUrl(): string | null {
  const value = process.env.REALTIME_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Best-effort immediate socket closure.
 *
 * The registry row is already revoked before this is called, so this is a
 * latency optimisation, not the security boundary: every new handshake
 * revalidates with `/internal/session/validate`, and any socket that reconnects
 * is rejected. A socket that is already open when this push fails can keep
 * receiving events until it disconnects; see
 * `audit/SESSION_REVOCATION_IMPLEMENTATION.md` for that failure window.
 *
 * Deliberately awaited with a short timeout so logout/reset responses do not
 * hang on a realtime outage. A failure is logged and the HTTP revocation still
 * stands.
 */
export async function revokeRealtimeSessions(
  revocation: RealtimeRevocation,
): Promise<boolean> {
  if (!revocation.userId) return true;

  const baseUrl = realtimeUrl();
  if (baseUrl) assertServiceUrl(baseUrl, process.env);
  const secret = process.env.REALTIME_PUBLISH_SECRET;
  if (!baseUrl || !secret) {
    // Realtime may be undeployed in local development. The session row is still
    // revoked; sockets cannot revalidate and will close on the next heartbeat.
    return false;
  }

  const body = JSON.stringify({
    userId: revocation.userId,
    ...(revocation.sid ? { sid: revocation.sid } : {}),
    ...(revocation.exceptSid ? { exceptSid: revocation.exceptSid } : {}),
    ...(revocation.all ? { all: true } : {}),
  });

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body,
        ...(process.env.APP_ENV !== "production" ? { redirect: "error" as const } : {}),
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.ok) return true;

      logEvent("warn", {
        event: "realtime.revoke.failed",
        status: response.status,
        attempt: attempt + 1,
        userId: revocation.userId,
      });
    } catch (error) {
      logEvent("warn", {
        event: "realtime.revoke.error",
        attempt: attempt + 1,
        userId: revocation.userId,
        error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  logEvent("error", {
    event: "realtime.revoke.exhausted",
    userId: revocation.userId,
  });
  return false;
}
