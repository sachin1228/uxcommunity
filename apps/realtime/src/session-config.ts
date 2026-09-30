/**
 * Session-verification configuration resolution — fail closed, and loud.
 *
 * WHY THIS EXISTS
 *   Every WebSocket handshake is authorized from the JWT in the
 *   `uxcommunity_session` cookie, verified with `SESSION_SECRET`. A Worker
 *   deployed without that secret cannot verify anything, so it answers 401 to
 *   every upgrade in the app — and the only symptom was a browser console full
 *   of "WebSocket connection to wss://… failed" with nothing in the Worker's own
 *   logs to say why. That is a server misconfiguration, not an unauthorized
 *   client: it must DENY (never authorize a socket from an unverifiable token)
 *   and it must be reportable, which is what this module decides.
 *
 *   The value is also trimmed. Secrets are deployed through CI (see
 *   .github/workflows/deploy.yml) and a value that arrives with whitespace —
 *   `echo` appends a newline — signs nothing the web app can verify, which is
 *   indistinguishable from a wrong secret at the client.
 *
 * Kept dependency-free so the decision can be unit-tested without a Worker.
 */

export interface SessionConfig {
  /** True only when a usable signing secret is actually configured. */
  configured: boolean;
  /** The trimmed secret, or null when unconfigured. */
  secret: string | null;
}

export function resolveSessionConfig(env: { SESSION_SECRET?: unknown }): SessionConfig {
  const raw = env.SESSION_SECRET;
  if (typeof raw !== "string") return { configured: false, secret: null };
  const secret = raw.trim();
  if (!secret) return { configured: false, secret: null };
  return { configured: true, secret };
}
