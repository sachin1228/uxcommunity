/**
 * Shared download helpers for master-data image sources. Auto-fetched photos
 * go through the same size/type rules as the manual uploader, so a fetched
 * image can never exceed what an admin could attach by hand.
 */

export interface FetchedImage {
  source: string;
  contentType: string;
  bytes: Buffer;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // match the manual upload limit
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Fetches with a short retry/backoff so source rate limits (429) don't fail a row. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      return res;
    } catch {
      if (attempt === attempts) return null;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return null;
}

export async function downloadImage(source: string, userAgent: string): Promise<FetchedImage | null> {
  const res = await fetchWithRetry(source, { headers: { "User-Agent": userAgent } });
  if (!res) return null;
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!ACCEPTED_IMAGE_TYPES.has(contentType)) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return { source, contentType, bytes };
}
