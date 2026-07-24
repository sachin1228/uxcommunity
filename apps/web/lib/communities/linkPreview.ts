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
