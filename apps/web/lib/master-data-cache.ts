/**
 * Cached master-data image lookups.
 *
 * Master tables (cities, design_sectors, companies, etc.) change very rarely.
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
  company:          { table: "companies",         idCol: "id" },
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
