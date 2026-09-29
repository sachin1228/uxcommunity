/**
 * Keeps `communities.image_url` in step with the master-data row it mirrors.
 *
 * WHY THIS EXISTS
 *   An app-created community's display picture resolves from its master row —
 *   `resolveCommunityDp()` in lib/communities/dp.ts reads
 *   `communities.image_url` only as the fallback when the master row has none.
 *   The community column is therefore a MIRROR of the master row, not an
 *   independent picture: the admin community-DP route writes both rows, the
 *   bulk "fetch images" tool deletes a replaced object only after checking the
 *   community column, and the orphan audit counts it as a live reference
 *   (see MASTER_IMAGE_LOOKUPS).
 *
 *   The per-type master PATCH routes used to write the master row alone, so the
 *   community column kept whatever image the community was created with. That
 *   stale value was both wrong and sticky: the old object stayed referenced, so
 *   the orphan scan could never reclaim it, and every surface that painted the
 *   column (rather than resolving the master row) showed the pre-replacement
 *   picture.
 *
 *   Failures here are logged, never thrown: the master row is already updated
 *   when a route calls this, so a mirror failure must not turn a successful
 *   admin edit into an error response. The response reports how many rows were
 *   written, so drift stays visible.
 */

import { MASTER_IMAGE_LOOKUPS } from "@uxcommunity/shared";

import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import type { DbClient } from "@/lib/r2-cleanup";
import type { MasterTable } from "./master-tables";

/**
 * The `communities.type` value each master table backs — the inverse of
 * TABLE_LOOKUP in lib/master-data-cache.ts, which resolves a community type to
 * its master table on the read path.
 */
export const COMMUNITY_TYPE_BY_MASTER_TABLE = {
  cities: "city",
  design_sectors: "sector",
  design_interests: "interest",
  experience_levels: "experience_level",
  job_titles: "job_title",
} as const satisfies Record<MasterTable, string>;

export interface MasterImageSyncResult {
  /** communities rows whose `image_url` was written — all get the same value. */
  mirrored: number;
  /**
   * What happened to the replaced object in R2, or null when there was nothing
   * to reclaim (no previous image, or the image did not actually change).
   */
  reclaimed: "deleted" | "referenced" | "missing" | "skipped" | null;
}

/**
 * Writes a master row's new (or cleared) image onto every community linked to
 * it, then reclaims the object it replaced from R2.
 *
 * A cleared image mirrors as null: the master row owns an app-created
 * community's picture, so removing it must remove the community's copy too —
 * otherwise the stale URL keeps the old object alive and shows up as a DP
 * nobody can account for.
 */
export async function syncMasterImageToCommunities({
  db,
  table,
  masterId,
  imageUrl,
  previousImageUrl = null,
}: {
  db: DbClient;
  table: MasterTable;
  masterId: string;
  /** The master row's new image; null clears the picture. */
  imageUrl: string | null;
  /** The master row's image before this update — what gets reclaimed from R2. */
  previousImageUrl?: string | null;
}): Promise<MasterImageSyncResult> {
  const { error, count } = await db
    .from("communities")
    .update({ image_url: imageUrl }, { count: "exact" })
    .eq("type", COMMUNITY_TYPE_BY_MASTER_TABLE[table])
    .eq("reference_id", masterId);

  if (error) {
    console.error("[master-data] community image mirror failed", {
      table,
      masterId,
      error,
    });
  }

  // The mirror above stopped pointing at the old object, and the master row was
  // updated by the caller before this ran — so only a shared reference (another
  // community, another master row) still keeps it alive. Best-effort: anything
  // that fails here is picked up by the admin orphan scan.
  let reclaimed: MasterImageSyncResult["reclaimed"] = null;
  if (previousImageUrl && previousImageUrl !== imageUrl) {
    try {
      reclaimed = (
        await deleteR2AssetIfUnreferenced(db, previousImageUrl, MASTER_IMAGE_LOOKUPS)
      ).status;
    } catch (cleanupError) {
      console.error("[master-data] replaced-image cleanup error:", cleanupError);
    }
  }

  return { mirrored: error ? 0 : count ?? 0, reclaimed };
}
