import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Whether `userId` holds a row in `community_members` for `communityId`.
 *
 * The single membership gate shared by route handlers and read models. Pass
 * the request's existing service client to reuse it; otherwise one is created.
 */
export async function isCommunityMember(
  communityId: string,
  userId: string,
  db: ServiceClient = createServiceClient(),
): Promise<boolean> {
  const { data } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
