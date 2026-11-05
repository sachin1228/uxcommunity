import "server-only";

import {
  getMasterImageMap,
  TABLE_LOOKUP,
} from "@/lib/master-data-cache";

/**
 * The display-picture payload sent to clients.
 *
 * Historical note: this used to also fetch and embed the community's Lottie
 * animation (`lottie_data`, base64 or parsed JSON) so the browser could play
 * it without a cross-origin fetch. That pipeline is gone — animated community
 * DPs were removed — and `lottie_*` fields stay only as nullable columns the
 * API surface still tolerates (always null now).
 */
export interface CommunityDpData {
  image_url: string | null;
}

/**
 * Picks the picture an app-created community shows: its mirrored copy first,
 * the master-data value only when no copy exists.
 *
 * WHY THIS ORDER
 *   Every master image write mirrors the new URL onto the linked community
 *   rows in the SAME request (lib/master-data/mirror-image.ts), so the stored
 *   column is never older than the master row. The master map, by contrast, is
 *   served from a 1-hour `unstable_cache` entry, and its `revalidateTag` is a
 *   no-op on the Worker (OpenNext's tag cache defaults to `dummy`). Preferring
 *   the map therefore hid a freshly fetched or replaced city picture on every
 *   resolved surface — admin communities, the sidebar, chat headers, previews
 *   — until the entry expired. The mirrored column is the fresh copy; the map
 *   stays as the fallback for rows that predate the mirror (or whose mirror
 *   write failed).
 */
export function resolveCommunityImage(
  stored: string | null,
  master: string | null | undefined,
): string | null {
  return stored ?? master ?? null;
}

/**
 * Resolves a community's display picture.
 *
 * The stored column wins; the master-data map (via reference_id) is the
 * fallback when the mirror has no value yet. See `resolveCommunityImage` for
 * why this order is the correct one on the deployed Worker.
 */
export async function resolveCommunityDp(input: {
  type: string;
  reference_id: string | null;
  image_url: string | null;
  lottie_url?: string | null;
  lottie_format?: string | null;
}): Promise<CommunityDpData> {
  if (input.image_url) return { image_url: input.image_url };

  const hasMasterData = Boolean(TABLE_LOOKUP[input.type]);
  if (!hasMasterData || !input.reference_id) return { image_url: null };

  const imageMap = await getMasterImageMap(input.type);
  return { image_url: imageMap[input.reference_id] ?? null };
}
