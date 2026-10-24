import { Image, type ImageRef } from 'expo-image';

/**
 * Measured image aspect ratios, keyed by URL. A card that leaves the list's
 * mount window and comes back would otherwise measure its image from scratch,
 * starting at the fallback height and jumping to the natural one when the
 * size lands — the layout shift felt while scrolling back up a feed.
 */
const ratios = new Map<string, number>();
const inFlight = new Map<string, Promise<number | null>>();
/** Old feed pages never scroll back this far; keep the map from growing forever. */
const MAX_CACHED_RATIOS = 500;

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
export function prefetchImageAspectRatios(urls: Array<string | null | undefined>): void {
  const queue = [...new Set(urls.filter((url): url is string => Boolean(url)))]
    .filter((url) => !cachedImageAspectRatio(url));
  const run = async () => {
    while (queue.length) await loadImageAspectRatio(queue.shift()!);
  };
  for (let worker = 0; worker < Math.min(3, queue.length); worker += 1) void run();
}
