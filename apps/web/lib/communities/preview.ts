import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { loadJoinEligibility } from "./join-eligibility";

type Db = ReturnType<typeof createServiceClient>;

/** Everything the community preview card renders, resolved server-side. */
export interface CommunityPreviewData {
  id: string;
  name: string;
  type: string;
  is_private: boolean;
  image_url: string | null;
  description: string | null;
  member_count: number;
  /** The public content the home feed surfaced here — empty when none. */
  public_counts: { threads?: number; events?: number; resources?: number; showcase?: number };
  can_join: boolean;
  has_pending_request: boolean;
  /** True when the viewer already belongs to this community. */
  joined: boolean;
}

/**
 * Resolve the read-only preview of a community for a non-member viewer: the
 * public facts the Explore page already shows, the number of public posts per
 * content area (the rows the home feed surfaces), and the viewer's Join
 * eligibility (same rules as get_all_communities and the detail-page banner).
 *
 * Returns null when the community does not exist or is inactive — the caller
 * decides what that means (the community page falls through to the chat's
 * "Community not found" state; the preview API answers 404).
 */
export async function loadCommunityPreview(
  db: Db,
  communityId: string,
  userId: string,
): Promise<CommunityPreviewData | null> {
  const [{ data: community }, { count: memberCount }, { data: membership }] = await Promise.all([
    db
      .from("communities")
      .select("id, name, type, reference_id, image_url, description, is_private")
      .eq("id", communityId)
      .eq("is_active", true)
      .maybeSingle(),
    db.from("community_members").select("community_id", { count: "exact", head: true }).eq("community_id", communityId),
    db.from("community_members").select("community_id").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
  ]);

  if (!community) return null;

  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const row = community as unknown as {
    id: string;
    name: string;
    type: string;
    reference_id: string | null;
    image_url: string | null;
    description: string | null;
    is_private: boolean | null;
  };

  // One count per public content area — the same rows the home feed
  // surfaces. Any query that fails simply hides its pill.
  const countRows = await Promise.all([
    db.from("community_threads").select("id", { count: "exact", head: true }).eq("community_id", communityId).eq("is_public", true),
    db.from("community_events").select("id", { count: "exact", head: true }).eq("community_id", communityId).eq("is_public", true),
    db.from("community_showcase_posts").select("id", { count: "exact", head: true }).eq("community_id", communityId).eq("is_public", true),
    db.from("community_resources").select("id", { count: "exact", head: true }).eq("community_id", communityId).eq("is_public", true),
  ]);

  const { canJoin, hasPendingRequest } = await loadJoinEligibility(
    db,
    {
      id: communityId,
      type: row.type,
      reference_id: row.reference_id,
      is_private: row.is_private ?? false,
    },
    userId,
  );

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    is_private: row.is_private ?? false,
    image_url: row.image_url,
    description: row.description,
    member_count: memberCount ?? 0,
    public_counts: {
      ...(countRows[0].count ? { threads: countRows[0].count } : {}),
      ...(countRows[1].count ? { events: countRows[1].count } : {}),
      ...(countRows[2].count ? { showcase: countRows[2].count } : {}),
      ...(countRows[3].count ? { resources: countRows[3].count } : {}),
    },
    can_join: canJoin,
    has_pending_request: hasPendingRequest,
    joined: Boolean(membership),
  };
}
