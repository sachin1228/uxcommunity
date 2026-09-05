import "server-only";

import { unstable_cache } from "next/cache";
import {
  getMasterImageMap,
  getMasterLottieMap,
  TABLE_LOOKUP,
} from "@/lib/master-data-cache";

export type LottieFormat = "json" | "dotlottie";

/**
 * The complete display-picture payload sent to clients. `lottie_data` is the
 * animation embedded server-side to dodge the R2 CORS block on browser
 * fetch():
 *   - 'json'      → the parsed Lottie JSON object (lottie-react)
 *   - 'dotlottie' → the .lottie file as a base64 string (client decodes to a
 *                   Uint8Array for the dotLottie player)
 */
export interface CommunityDpData {
  image_url: string | null;
  lottie_url: string | null;
  lottie_format: LottieFormat | null;
  lottie_data: unknown | null;
}

/** Cached per-URL: parsed Lottie JSON, or base64 for .lottie binaries. */
export const embedLottieData = unstable_cache(
  async (url: string, format: LottieFormat): Promise<unknown | null> => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      if (format === "json") return await res.json();
      const buffer = Buffer.from(await res.arrayBuffer());
      return buffer.toString("base64");
    } catch {
      return null;
    }
  },
  ["community-lottie-data"],
  { revalidate: 3600, tags: ["master-images"] }
);

/**
 * Resolves a community's display picture the same way the app resolves
 * images everywhere: the master-data row (via reference_id) wins, with the
 * stored communities columns as fallback. Optionally embeds the animation
 * payload so client components can play it without a cross-origin fetch.
 */
export async function resolveCommunityDp(input: {
  type: string;
  reference_id: string | null;
  image_url: string | null;
  lottie_url: string | null;
  lottie_format: string | null;
  embedLottie?: boolean;
}): Promise<CommunityDpData> {
  let image_url = input.image_url ?? null;
  let lottie_url = input.lottie_url ?? null;
  let lottie_format = (input.lottie_format as LottieFormat | null) ?? null;

  const hasMasterData = Boolean(TABLE_LOOKUP[input.type]);
  if (hasMasterData && input.reference_id) {
    const [imageMap, lottieMap] = await Promise.all([
      getMasterImageMap(input.type),
      getMasterLottieMap(input.type),
    ]);
    image_url = imageMap[input.reference_id] ?? image_url;
    const masterLottie = lottieMap[input.reference_id];
    if (masterLottie?.lottie_url) {
      lottie_url = masterLottie.lottie_url;
      lottie_format = (masterLottie.lottie_format as LottieFormat | null) ?? null;
    }
  }

  let lottie_data: unknown = null;
  if (input.embedLottie && lottie_url && lottie_format) {
    lottie_data = await embedLottieData(lottie_url, lottie_format);
  }

  return { image_url, lottie_url, lottie_format, lottie_data };
}
