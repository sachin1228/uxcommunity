/**
 * Link-preview shared types and utilities.
 * Kept in lib/ so both the API route and client components can import from here
 * without creating circular dependency on the Next.js App Router route module.
 */

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  /** Absolute URL to the OG / twitter image, if any. */
  image: string | null;
  /** og:site_name or derived from hostname. */
  siteName: string | null;
}

/**
 * Extract the first HTTP/HTTPS URL from a plain-text string.
 * Strips trailing punctuation characters that are unlikely to be part of a URL
 * (e.g. "Check this out: https://example.com." → "https://example.com").
 */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"'()[\]{}]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)]+$/, "");
}

/**
 * Normalize a URL for cache-keying so equivalent forms (case, trailing slash,
 * fragment, default port, query-parameter order) share one cache entry.
 * Used by both the client-side link-preview cache and the API route's
 * in-process cache so the same page never triggers duplicate upstream fetches.
 * Falls back to the trimmed input when it isn't a parseable URL.
 */
export function normalizePreviewUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    // Fragments aren't sent to the server and don't change the page metadata.
    url.hash = "";
    // Parameter order shouldn't cause separate requests.
    url.searchParams.sort();
    // Drop default ports.
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    // Trailing slash on the path is equivalent for metadata purposes.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}
