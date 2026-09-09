/**
 * Shared R2 media reference schema — the single source of truth for which
 * database columns can hold R2 media URLs.
 *
 * Consumed by the web app (`apps/web/lib/r2.ts` / `lib/r2-cleanup.ts`) for
 * runtime deletion and the admin orphan audit, and by the shared-package
 * unit tests. Keeping the schema in one place guarantees every consumer
 * agrees on what counts as a reference.
 */

export interface MediaReferenceLookup {
  table: string;
  column: string;
  /** Extract URL strings from a stored value (JSON attachment columns). */
  getUrls?: (value: unknown) => string[];
}

/** Extract attachment URLs from a stored attachments JSON array. */
export function attachmentUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === "object" && item && typeof (item as Record<string, unknown>).url === "string"
        ? ((item as Record<string, unknown>).url as string)
        : ""
    )
    .filter(Boolean);
}

/** Extract video-poster URLs from a stored attachments JSON array. */
export function attachmentPosterUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "object" && item ? (item as Record<string, unknown>).poster : null))
    .filter((poster): poster is string => typeof poster === "string" && poster.length > 0);
}

/**
 * Extract the R2 object key from a public URL, or null when the URL does not
 * live on the given public base (e.g. legacy Supabase storage URLs).
 */
export function r2KeyFromUrl(url: string, publicBase: string): string | null {
  try {
    const base = publicBase.replace(/\/+$/, "");
    if (!url.startsWith(base + "/")) return null;
    return url.slice(base.length + 1);
  } catch {
    return null;
  }
}

/** Get the URLs a lookup extracts from a stored row value. */
export function referenceUrlsFromValue(lookup: MediaReferenceLookup, value: unknown): string[] {
  if (lookup.getUrls) return lookup.getUrls(value);
  return typeof value === "string" ? [value] : [];
}

export const SHOWCASE_ATTACHMENT_LOOKUP: MediaReferenceLookup = {
  table: "community_showcase_posts",
  column: "attachments",
  getUrls: attachmentUrls,
};

export const SHOWCASE_POSTER_LOOKUP: MediaReferenceLookup = {
  table: "community_showcase_posts",
  column: "attachments",
  getUrls: attachmentPosterUrls,
};

export const THREAD_ATTACHMENT_LOOKUP: MediaReferenceLookup = {
  table: "community_threads",
  column: "attachments",
  getUrls: attachmentUrls,
};

/** Master-data + community display pictures can be mirrored across rows, so a
 *  deletion must check every column that can hold the same object. */
export const MASTER_IMAGE_LOOKUPS: MediaReferenceLookup[] = [
  { table: "communities", column: "image_url" },
  { table: "cities", column: "image_url" },
  { table: "design_sectors", column: "image_url" },
  { table: "design_interests", column: "image_url" },
  { table: "experience_levels", column: "image_url" },
];

export const MASTER_LOTTIE_LOOKUPS: MediaReferenceLookup[] = [
  { table: "communities", column: "lottie_url" },
  { table: "cities", column: "lottie_url" },
  { table: "design_sectors", column: "lottie_url" },
  { table: "design_interests", column: "lottie_url" },
  { table: "experience_levels", column: "lottie_url" },
];

/** Every column across the app that can hold an R2 media URL. */
export const ALL_MEDIA_LOOKUPS: MediaReferenceLookup[] = [
  { table: "designer_profiles", column: "avatar_url" },
  { table: "communities", column: "image_url" },
  { table: "communities", column: "lottie_url" },
  { table: "cities", column: "image_url" },
  { table: "cities", column: "lottie_url" },
  { table: "design_sectors", column: "image_url" },
  { table: "design_sectors", column: "lottie_url" },
  { table: "design_interests", column: "image_url" },
  { table: "design_interests", column: "lottie_url" },
  { table: "experience_levels", column: "image_url" },
  { table: "experience_levels", column: "lottie_url" },
  { table: "community_messages", column: "image_url" },
  { table: "community_events", column: "cover_image_url" },
  { table: "community_showcase_posts", column: "image_url" },
  SHOWCASE_ATTACHMENT_LOOKUP,
  SHOWCASE_POSTER_LOOKUP,
  THREAD_ATTACHMENT_LOOKUP,
  { table: "lottie_settings", column: "lottie_url" },
];

/** Human-readable entity type per lookup, for reports. */
export const LOOKUP_ENTITY_TYPES: Record<string, string> = {
  "designer_profiles.avatar_url": "profile",
  "communities.image_url": "community",
  "communities.lottie_url": "community",
  "cities.image_url": "city",
  "cities.lottie_url": "city",
  "design_sectors.image_url": "sector",
  "design_sectors.lottie_url": "sector",
  "design_interests.image_url": "interest",
  "design_interests.lottie_url": "interest",
  "experience_levels.image_url": "experience_level",
  "experience_levels.lottie_url": "experience_level",
  "community_messages.image_url": "message",
  "community_events.cover_image_url": "event",
  "community_showcase_posts.image_url": "showcase",
  "community_showcase_posts.attachments": "showcase",
  "community_threads.attachments": "thread",
  "lottie_settings.lottie_url": "lottie_setting",
};