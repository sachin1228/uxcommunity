/**
 * Pure request-origin rules used by middleware.
 *
 * Keeping these free of NextRequest lets the HTTP/HTTPS and CSRF decisions be
 * unit-tested without a running Worker. The middleware supplies the values it
 * observes from Cloudflare/Next headers.
 */

export interface HttpsDecisionInput {
  /** `request.nextUrl.protocol`, e.g. `http:` or `https:`. */
  protocol: string;
  host: string;
  /** First `x-forwarded-proto` value, when Cloudflare/OpenNext provides one. */
  forwardedProto?: string | null;
  /** `cf-visitor` scheme (`http`/`https`) when present. */
  cfVisitorScheme?: string | null;
}

export interface OriginDecisionInput {
  origin: string | null;
  requestHost: string;
  secFetchSite?: string | null;
}

/** Local/development hosts must stay usable over plain HTTP. */
export function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0].trim().toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

function normaliseProtocol(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim().toLowerCase();
  return first === "http" || first === "https" ? first : null;
}

/**
 * True when a request arrived over HTTP on a non-local host and must be
 * redirected to HTTPS. `x-forwarded-proto` wins over the URL protocol because
 * OpenNext can reconstruct an internal URL whose scheme differs from the
 * browser-facing request.
 */
export function shouldRedirectToHttps(input: HttpsDecisionInput): boolean {
  if (isLocalHost(input.host)) return false;
  const scheme =
    normaliseProtocol(input.forwardedProto) ??
    normaliseProtocol(input.cfVisitorScheme) ??
    normaliseProtocol(input.protocol);
  return scheme === "http";
}

/**
 * Reject browser mutations whose Origin is another host, or whose
 * Sec-Fetch-Site explicitly says cross-site. Requests without an Origin
 * (native mobile clients, server-to-server Workers) remain allowed; they use
 * their own authorization gates.
 */
export function isAllowedMutationOrigin(input: OriginDecisionInput): boolean {
  if (input.secFetchSite?.toLowerCase() === "cross-site") return false;
  if (!input.origin) return true;

  try {
    const url = new URL(input.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.host === input.requestHost;
  } catch {
    return false;
  }
}
