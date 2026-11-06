/**
 * URL rules shared by every surface that stores or renders a member-supplied
 * link. Only http(s) survives; `javascript:`, `data:`, `file:`, `vbscript:`
 * and malformed values are rejected before they can reach an `href`.
 *
 * The server uses `normalizeSafeHttpUrl` / `normalizeSafeLinkedInUrl` before
 * persistence. Components use `safeExternalUrl` to turn an already-stored
 * value into an href (or null), so a legacy row written before this validation
 * existed still cannot execute script.
 */

const MAX_URL_LENGTH = 2048;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export interface SafeUrlOptions {
  /** Add `https://` when the member omitted the scheme (form-friendly). */
  allowBareDomain?: boolean;
}

/**
 * Normalize a member-supplied URL to an absolute http(s) URL, or null.
 *
 * Credentials, control characters, non-http(s) schemes and overlong values
 * are rejected. A URL without a scheme is only accepted when the caller opts
 * into the form-friendly `https://` prefix.
 */
export function normalizeSafeHttpUrl(
  raw: unknown,
  options: SafeUrlOptions = {},
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  if (CONTROL_CHARACTERS.test(trimmed)) return null;

  const candidate =
    options.allowBareDomain && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * A LinkedIn profile URL: http(s), no credentials, and the host is LinkedIn
 * (any subdomain, `www` included). A bare `linkedin.com/in/...` is accepted
 * and normalized to https.
 */
export function normalizeSafeLinkedInUrl(raw: unknown): string | null {
  const normalized = normalizeSafeHttpUrl(raw, { allowBareDomain: true });
  if (!normalized) return null;
  try {
    const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Render-time conversion. Stored values may predate server validation, so the
 * same checks run again here; a value that cannot become an http(s) link
 * renders as null (callers show plain text or nothing).
 */
export function safeExternalUrl(raw: unknown): string | null {
  return normalizeSafeHttpUrl(raw, { allowBareDomain: true });
}
