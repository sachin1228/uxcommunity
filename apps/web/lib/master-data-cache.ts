/**
 * Cached master-data image lookups.
 *
 * Master tables (cities, design_sectors, etc.) change very rarely.
 * Caching their image_url maps server-side for 1 hour removes the per-request
 * Supabase round-trip and the associated DB read bytes / egress cost.
 *
 * We cache the ENTIRE table per type (not filtered by specific IDs) so the
 * cache stays warm across different community lists and avoids per-ID
 * cache proliferation.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";

export const TABLE_LOOKUP: Record<string, { table: string; idCol: string }> = {
  city:             { table: "cities",            idCol: "id" },
  sector:           { table: "design_sectors",    idCol: "id" },
  interest:         { table: "design_interests",  idCol: "id" },
  experience_level: { table: "experience_levels", idCol: "id" },
};

/**
 * Returns a map of { referenceId → image_url | null } for a master data table.
 * Results are cached for 1 hour (revalidated on the `master-images` tag).
 *
 * Call `revalidateTag("master-images")` in admin upload/update routes to
 * flush this cache whenever a master image is changed.
 */
export const getMasterImageMap = unstable_cache(
  async (type: string): Promise<Record<string, string | null>> => {
    const lookup = TABLE_LOOKUP[type];
    if (!lookup) return {};
    const db = createServiceClient();
    const { data: rows } = await db
      .from(lookup.table as any)
      .select(`${lookup.idCol}, image_url`);
    return Object.fromEntries(
      (rows ?? []).map((r: any) => [r[lookup.idCol], r.image_url ?? null])
    ) as Record<string, string | null>;
  },
  ["master-image-map"],
  { revalidate: 3600, tags: ["master-images"] }
);

/**
 * Returns a map of { referenceId → { lottie_url, lottie_format } } for a
 * master data table. Mirrors getMasterImageMap — 1 hour, same tag — so the
 * animated community display picture stays in sync with master data.
 */
export const getMasterLottieMap = unstable_cache(
  async (type: string): Promise<Record<string, { lottie_url: string | null; lottie_format: string | null } | null>> => {
    const lookup = TABLE_LOOKUP[type];
    if (!lookup) return {};
    const db = createServiceClient();
    const { data: rows } = await db
      .from(lookup.table as any)
      .select(`${lookup.idCol}, lottie_url, lottie_format`);
    return Object.fromEntries(
      (rows ?? []).map((r: any) => [
        r[lookup.idCol],
        r.lottie_url ? { lottie_url: r.lottie_url, lottie_format: r.lottie_format ?? null } : null,
      ])
    ) as Record<string, { lottie_url: string | null; lottie_format: string | null } | null>;
  },
  ["master-lottie-map"],
  { revalidate: 3600, tags: ["master-images"] }
);

/**
 * Returns a map of { referenceId → name } for a master data table.
 * Cached alongside image maps — 1 hour, same tag.
 */
export const getMasterNameMap = unstable_cache(
  async (type: string): Promise<Record<string, string>> => {
    const lookup = TABLE_LOOKUP[type];
    if (!lookup) return {};
    const db = createServiceClient();
    const { data: rows } = await db
      .from(lookup.table as any)
      .select(`${lookup.idCol}, name`);
    return Object.fromEntries(
      (rows ?? []).map((r: any) => [r[lookup.idCol], r.name ?? ""])
    ) as Record<string, string>;
  },
  ["master-name-map"],
  { revalidate: 3600, tags: ["master-images"] }
);

/**
 * Returns experience-level display names keyed by slug. This removes a
 * per-request lookup from community detail responses while keeping labels
 * consistent with the values managed in the experience-level master table.
 */
export const getExperienceLevelNameMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const db = createServiceClient();
    const { data: rows } = await db
      .from("experience_levels")
      .select("slug, name");
    return Object.fromEntries(
      (rows ?? []).map((row) => [row.slug, row.name ?? ""])
    );
  },
  ["experience-level-name-map"],
  { revalidate: 3600, tags: ["master-images"] }
);
