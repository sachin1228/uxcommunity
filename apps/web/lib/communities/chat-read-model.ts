import "server-only";
import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import { canStoreShowcaseFlag } from "./showcase-flag";
import { resolveCommunityDp } from "./dp";
import type { CachedMeta } from "./cache/types";
import type { ReadResult } from "./read-models";

/** Access-checked header snapshot. Member previews, About, grants and mute
 * settings belong to the full read model loaded after the first chat paint. */
export const loadCommunityChatReadModel = cache(async (
  communityId: string, userId: string,
): Promise<ReadResult<{ community: CachedMeta["community"]; members: []; lastReadAt: string | null }>> => {
  const db = createServiceClient();
  const showcaseSupported = await canStoreShowcaseFlag(db);
  const [membershipResult, communityResult] = await Promise.all([
    db.from("community_members").select("last_read_at")
      .eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    (showcaseSupported
      ? db.from("communities").select("id, name, type, image_url, reference_id, is_private, enabled_tabs, showcase_enabled")
      : db.from("communities").select("id, name, type, image_url, reference_id, is_private, enabled_tabs"))
      .eq("id", communityId).eq("is_active", true).maybeSingle(),
  ]);
  if (membershipResult.error) return { ok: false, status: 500, error: "Failed to verify community membership." };
  if (!membershipResult.data) return { ok: false, status: 403, error: "Not a member of this community." };
  const community = communityResult.data;
  if (communityResult.error || !community) return { ok: false, status: 404, error: "Community not found." };
  const dp = await resolveCommunityDp({
    type: community.type, reference_id: community.reference_id, image_url: community.image_url ?? null,
  });
  return {
    ok: true,
    data: {
      community: {
        id: community.id, name: community.name, type: community.type,
        image_url: dp.image_url,
        is_private: community.is_private,
        enabled_tabs: community.enabled_tabs ?? undefined,
        showcase_enabled: "showcase_enabled" in community && typeof community.showcase_enabled === "boolean"
          ? community.showcase_enabled : null,
        // Kept for the existing client shape; hidden until full details arrive.
        member_count: 0,
        details_loaded: false,
      },
      members: [],
      lastReadAt: membershipResult.data.last_read_at ?? null,
    },
  };
});
