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
 * Resolves a community's display picture the same way the app resolves
 * images everywhere: the master-data row (via reference_id) wins, with the
 * stored communities column as fallback.
 */
export async function resolveCommunityDp(input: {
  type: string;
  reference_id: string | null;
  image_url: string | null;
  lottie_url?: string | null;
  lottie_format?: string | null;
}): Promise<CommunityDpData> {
  let image_url = input.image_url ?? null;

  const hasMasterData = Boolean(TABLE_LOOKUP[input.type]);
  if (hasMasterData && input.reference_id) {
    const imageMap = await getMasterImageMap(input.type);
    image_url = imageMap[input.reference_id] ?? image_url;
  }

  return { image_url };
}
