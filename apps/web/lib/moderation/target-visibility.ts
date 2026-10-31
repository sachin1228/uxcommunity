import type { ServiceClient } from "@/lib/supabase/service";

/**
 * A report may only name content the reporter can actually see.
 *
 * The target loaders use the service role, so without this check any
 * authenticated member who guessed a UUID could file a report on private
 * content. Community privacy is checked here; callers also pass
 * `requireMembership` for a public community's member-only content (private
 * posts/events and community chat). Public content and content outside a
 * community remain reportable by any signed-in member.
 */
export async function canReportTarget(
  db: ServiceClient,
  viewerId: string,
  communityId: string | null,
  requireMembership = false,
): Promise<boolean> {
  if (!communityId) return true;

  if (requireMembership) {
    return isMember(db, communityId, viewerId);
  }

  const { data: community, error } = await db
    .from("communities")
    .select("is_private")
    .eq("id", communityId)
    .maybeSingle();
  if (error) return false;
  if (!community?.is_private) return true;

  return isMember(db, communityId, viewerId);
}

async function isMember(
  db: ServiceClient,
  communityId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership, error } = await db
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && Boolean(membership);
}
