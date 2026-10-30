import type { ServiceClient } from "@/lib/supabase/service";

/**
 * A report may only name content the reporter can actually see.
 *
 * The target loaders use the service role, so without this check any
 * authenticated member who guessed a UUID could file a report on private
 * community content. Public content and content outside a community remain
 * reportable by any signed-in member.
 */
export async function canReportTarget(
  db: ServiceClient,
  viewerId: string,
  communityId: string | null,
): Promise<boolean> {
  if (!communityId) return true;

  const { data: community, error } = await db
    .from("communities")
    .select("is_private")
    .eq("id", communityId)
    .maybeSingle();
  if (error) return false;
  if (!community?.is_private) return true;

  const { data: membership, error: membershipError } = await db
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("user_id", viewerId)
    .maybeSingle();
  return !membershipError && Boolean(membership);
}
