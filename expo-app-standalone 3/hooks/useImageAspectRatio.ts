import { useEffect, useState } from 'react';
import { cachedImageAspectRatio, loadImageAspectRatio } from '@/lib/imageAspectRatio';

/**
 * Natural aspect ratio of a remote image, or null while it is unknown.
 *
 * A cached ratio is returned synchronously on the first render, so a card
 * that remounts while scrolling lays out at its final height immediately
 * instead of re-measuring and jumping.
 */
export function useImageAspectRatio(url?: string | null): number | null {
  const [measured, setMeasured] = useState(() => ({
    url,
    ratio: cachedImageAspectRatio(url),
  }));

  // A prop change renders before the effect runs; read the cache for the new
  // URL directly so one frame never shows the previous image's shape.
  const ratio = measured.url === url ? measured.ratio : cachedImageAspectRatio(url);

  useEffect(() => {
    if (!url) {
      setMeasured({ url, ratio: null });
      return;
    }
    const cached = cachedImageAspectRatio(url);
    if (cached) {
      setMeasured({ url, ratio: cached });
      return;
    }
    let active = true;
    void loadImageAspectRatio(url).then((next) => {
      if (active && next) setMeasured({ url, ratio: next });
    });
    return () => {
      active = false;
    };
  }, [url]);

  return ratio;
}
