/**
 * Which remote images may go through Next's image optimizer.
 *
 * Avatars and community DPs are uploaded to R2 as full-size WebP (up to 400px
 * for avatars, larger for community faces) and are displayed as small as 24px
 * in the sidebar and chat lists. The optimizer resizes them to the requested
 * width and caches the variant at the edge, instead of every row downloading
 * the original. Only hosts configured in next.config's `remotePatterns` are
 * eligible; anything else falls back to a plain <img> so an unknown host can
 * never turn into a runtime image error.
 */

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isOptimizableImageUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const r2Origin = originOf(process.env.NEXT_PUBLIC_R2_PUBLIC_URL);
  if (r2Origin && parsed.origin === r2Origin) return true;

  const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (
    supabaseOrigin &&
    parsed.origin === supabaseOrigin &&
    parsed.pathname.startsWith("/storage/v1/object/public/")
  ) {
    return true;
  }
  return false;
}
