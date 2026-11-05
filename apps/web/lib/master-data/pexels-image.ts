/**
 * Pexels photo lookup for city master-data rows. The Admin "Fetch images"
 * action tries it before Wikipedia for cities: Pexels' curated city
 * photography looks far better than Wikipedia lead images, and its license
 * allows commercial use without attribution.
 */

import { downloadImage, fetchWithRetry, type FetchedImage } from "./image-fetch";

const PEXELS_API = "https://api.pexels.com/v1/search";
const PEXELS_UA = "FreebuffAdmin/1.0 (admin master-data image sync)";
const PER_PAGE = 20;

const SCENIC = /city|skyline|street|aerial|building|architecture|downtown|town|view|coast|beach|landmark/i;
const PEOPLE = /\b(person|people|man|woman|girl|boy|portrait|model|couple|friend)\b/i;

interface PexelsPhoto {
  alt?: string | null;
  src?: { large2x?: string; large?: string };
}

/** True when PEXELS_API_KEY is configured; without it cities stay on Wikipedia. */
export function isPexelsConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY?.trim());
}

/**
 * Resolves a photo for a city from Pexels. One search request per row keeps
 * the project inside Pexels' 200 requests/hour limit for a full city sync;
 * rows with no usable photo return null and the caller falls back to
 * Wikipedia.
 */
export async function findPexelsImage(query: string): Promise<FetchedImage | null> {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    query,
    orientation: "landscape",
    per_page: String(PER_PAGE),
  });
  const res = await fetchWithRetry(`${PEXELS_API}?${params}`, {
    headers: { Authorization: apiKey, "User-Agent": PEXELS_UA, Accept: "application/json" },
  });
  if (!res || !res.ok) return null;

  const data = (await res.json().catch(() => null)) as { photos?: PexelsPhoto[] } | null;
  for (const photo of rankPhotos(data?.photos ?? [], query)) {
    const source = photo.src?.large2x ?? photo.src?.large;
    if (!source) continue;
    const image = await downloadImage(source, PEXELS_UA);
    if (image) return image;
  }
  return null;
}

/**
 * Pexels relevance can put a travel portrait above the cityscape, so photos
 * whose description mentions the city or reads like a skyline/street shot
 * are moved up; people-first descriptions move down.
 */
function rankPhotos(photos: PexelsPhoto[], query: string): PexelsPhoto[] {
  const city = query.trim().toLowerCase();
  return photos
    .map((photo, index) => {
      const alt = (photo.alt ?? "").toLowerCase();
      let score = 0;
      if (city && alt.includes(city)) score += 3;
      if (SCENIC.test(alt)) score += 2;
      if (PEOPLE.test(alt)) score -= 2;
      return { photo, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.photo);
}
