import { fetchWebService } from "./web-service";
import type { Env } from "./env";
import { resolveMembershipConfig } from "./membership-config";

const VALIDATION_TIMEOUT_MS = 2_500;

/**
 * Ask the web app whether a signed session is still live.
 *
 * The realtime Worker cannot read Supabase directly, so this is the one call
 * that turns the JWT's `sid`/`sv` claims into a database-backed decision at
 * handshake time. It is deliberately fail-closed: a timeout, non-2xx, malformed
 * body or a response for a different user all reject the socket.
 *
 * Once a socket is open, this is NOT called per frame. Revocation is pushed to
 * the user's Durable Object, which closes matching sockets.
 */
export async function validateSessionWithApi(
  env: Env,
  claims: { userId: string; sid: string; sv: number },
): Promise<boolean> {
  const config = resolveMembershipConfig(env);
  if (!config.configured || !config.apiUrl || !env.API_SECRET) return false;

  try {
    const response = await fetchWebService(env, `${config.apiUrl}/api/internal/session/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.API_SECRET}`,
      },
      body: JSON.stringify(claims),
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      if (env.APP_ENV !== "production") console.error("[session] isolated validation failed", { status: response.status });
      return false;
    }

    const body = (await response.json()) as {
      ok?: unknown;
      userId?: unknown;
      sessionVersion?: unknown;
    };

    return (
      body?.ok === true &&
      body.userId === claims.userId &&
      body.sessionVersion === claims.sv
    );
  } catch (error) {
    if (env.APP_ENV !== "production") console.error("[session] isolated validation could not complete", error instanceof Error ? error.message : "Unknown failure");
    return false;
  }
}

/** Constant-time-ish comparison for the internal publish/revoke secret. */
export function secretMatches(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
