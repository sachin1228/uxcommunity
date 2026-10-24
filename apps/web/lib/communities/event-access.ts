import "server-only";
import { isPublicContentScope } from "@/lib/content-scope";
import { isCommunityMember } from "@/lib/communities/membership";
import type { ServiceClient } from "@/lib/supabase/service";

export type EventAccessResult<T extends { is_public: boolean }> =
  | { ok: true; event: T }
  | { ok: false; status: 403 | 404 };

/**
 * Load an event only when the caller may see it.
 *
 * Public events are open to any signed-in member. A private event belongs to
 * its community, so a non-member must not reach it even with a valid event id.
 * `select` must include `is_public`; every other requested column is returned
 * untouched.
 */
export async function loadEventForViewer<T extends { is_public: boolean }>(
  db: ServiceClient,
  communityId: string,
  eventId: string,
  userId: string,
  select: string,
): Promise<EventAccessResult<T>> {
  const publicScope = isPublicContentScope(communityId);
  let query = db.from("community_events").select(select).eq("id", eventId);
  query = publicScope
    ? query.eq("is_public", true).is("community_id", null)
    : query.eq("community_id", communityId);

  const { data } = await query.maybeSingle();
  if (!data) return { ok: false, status: 404 };

  const event = data as unknown as T;
  if (
    !publicScope &&
    !event.is_public &&
    !(await isCommunityMember(communityId, userId, db))
  ) {
    return { ok: false, status: 403 };
  }

  return { ok: true, event };
}
