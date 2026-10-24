import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, type ImageRef } from 'expo-image';

/**
 * Measured image aspect ratios, keyed by URL. A card that leaves the list's
 * mount window and comes back would otherwise measure its image from scratch,
 * starting at the fallback height and jumping to the natural one when the
 * size lands — the layout shift felt while scrolling back up a feed.
 *
 * The map is persisted so a cold start paints cached feed images at their
 * final height too, before any measurement can finish.
 */
const ratios = new Map<string, number>();
const inFlight = new Map<string, Promise<number | null>>();
/** Old feed pages never scroll back this far; keep the map from growing forever. */
const MAX_CACHED_RATIOS = 500;
const STORAGE_KEY = 'ux:image-aspect-ratios:v1';

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const entries = [...ratios.entries()].slice(-MAX_CACHED_RATIOS);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => undefined);
  }, 1000);
}

function hydrate(): void {
  void AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      const stored = JSON.parse(raw) as unknown;
      if (!Array.isArray(stored)) return;
      for (const entry of stored) {
        if (!Array.isArray(entry)) continue;
        const [url, ratio] = entry as [unknown, unknown];
        if (typeof url === 'string' && typeof ratio === 'number' && ratio > 0 && !ratios.has(url)) {
          ratios.set(url, ratio);
        }
      }
    })
    .catch(() => undefined);
}

hydrate();

export function cachedImageAspectRatio(url?: string | null): number | null {
  return url ? ratios.get(url) ?? null : null;
}

export function rememberImageAspectRatio(url: string, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  ratios.delete(url);
  ratios.set(url, width / height);
  while (ratios.size > MAX_CACHED_RATIOS) {
    const oldest = ratios.keys().next().value;
    if (oldest === undefined) break;
    ratios.delete(oldest);
  }
  persistSoon();
}

/**
 * Measure an image through expo-image's own loader. That is the cache the
 * card renders from, so warming the ratio is not a second download. Resolves
 * null when the image cannot be loaded; the card then measures on mount.
 */
export function loadImageAspectRatio(url: string): Promise<number | null> {
  const cached = cachedImageAspectRatio(url);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(url);
  if (pending) return pending;
  const task = Image.loadAsync(url)
    .then((image: ImageRef) => {
      rememberImageAspectRatio(url, image.width, image.height);
      image.release();
      return cachedImageAspectRatio(url);
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, task);
  return task;
}

/**
 * Warm the ratios for a page's media before its cards mount, three at a time
 * so the prefetch does not starve the images the member can already see.
 */
export async function prefetchImageAspectRatios(
  urls: Array<string | null | undefined>,
): Promise<void> {
  const queue = [...new Set(urls.filter((url): url is string => Boolean(url)))]
    .filter((url) => !cachedImageAspectRatio(url));
  const run = async () => {
    while (queue.length) await loadImageAspectRatio(queue.shift()!);
  };
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, run),
  );
}
