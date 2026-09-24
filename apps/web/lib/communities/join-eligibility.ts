import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;

export interface JoinEligibility {
  /** False when the community is closed to this member (profile-derived types their profile doesn't match). */
  canJoin: boolean;
  /** True when a private community's join request is already pending. */
  hasPendingRequest: boolean;
}

/**
 * Whether this member may join a community outright, mirroring the Explore
 * page's rule (`get_all_communities`): open to interest/general/user types,
 * profile-derived types need a profile match, and private communities go
 * through the owner-approval request flow. CommunityPreview on the community
 * page applies the same rule — keep the two in step.
 *
 * Non-open types resolve the matching reference id from the member's profile;
 * a failed lookup simply reads as not eligible. The pending-request check is
 * skipped when the caller already knows the community is open (a request can
 * only exist for private communities).
 */
export async function loadJoinEligibility(
  db: Db,
  community: { id: string; type: string; reference_id: string | null; is_private: boolean },
  userId: string,
): Promise<JoinEligibility> {
  const [profileResult, pendingRequestResult] = await Promise.all([
    community.type === "interest" || community.type === "general" || community.type === "user"
      ? Promise.resolve({ data: null })
      : db
          .from("designer_profiles")
          .select("city_id, sector_id, experience_level, job_title")
          .eq("user_id", userId)
          .maybeSingle(),
    community.is_private
      ? db
          .from("community_join_requests")
          .select("community_id")
          .eq("community_id", community.id)
          .eq("user_id", userId)
          .eq("status", "pending")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let canJoin = false;
  if (community.type === "interest" || community.type === "general" || community.type === "user") {
    canJoin = true;
  } else if (profileResult.data) {
    const profile = profileResult.data as unknown as {
      city_id: string | null;
      sector_id: string | null;
      experience_level: string | null;
      job_title: string | null;
    };
    if (community.type === "sector") canJoin = profile.sector_id === community.reference_id;
    else if (community.type === "city") canJoin = profile.city_id === community.reference_id;
    else if (community.type === "experience_level" && profile.experience_level) {
      const { data: expLevel } = await db
        .from("experience_levels")
        .select("id")
        .eq("slug", profile.experience_level)
        .maybeSingle();
      canJoin = (expLevel as unknown as { id: string } | null)?.id === community.reference_id;
    } else if (community.type === "job_title" && profile.job_title) {
      const { data: jobTitle } = await db
        .from("job_titles")
        .select("id")
        .eq("slug", profile.job_title)
        .maybeSingle();
      canJoin = (jobTitle as unknown as { id: string } | null)?.id === community.reference_id;
    }
  }

  return {
    canJoin,
    hasPendingRequest: Boolean(pendingRequestResult.data),
  };
}
