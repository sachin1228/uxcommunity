import { Image } from 'expo-image';
import { recentChatMediaUrls } from './chatMedia';
import { prefetchImageAspectRatios } from './imageAspectRatio';

/**
 * How long a page waits for its newest images to be measured before it is
 * committed. Past the bound the page paints with 4:3 frames and each unmeasured
 * image corrects itself once, rather than holding the room on a spinner for
 * slow media.
 */
export const CHAT_MEDIA_WARM_TIMEOUT_MS = 700;

/**
 * Warm the images of a chat page before it is committed.
 *
 * The ratio cache (lib/imageAspectRatio) is what lets a bubble mount at its
 * final width; `Image.prefetch` then puts the pixels in expo-image's own
 * memory/disk cache, so the mounted `<Image>` does not start a second download.
 * Only the newest rows of the page are considered (see recentChatMediaUrls).
 */
export async function warmChatMedia(
  messages: ReadonlyArray<{ image_url?: string | null }>,
  timeoutMs: number = CHAT_MEDIA_WARM_TIMEOUT_MS,
): Promise<void> {
  const urls = recentChatMediaUrls(messages);
  if (urls.length === 0) return;

  void Image.prefetch(urls, 'memory-disk').catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    prefetchImageAspectRatios(urls),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
    }),
  ]);
  if (timer) clearTimeout(timer);
}
