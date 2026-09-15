import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { CachedMeta } from "./cache";

/**
 * Lightweight server snapshot for the community chat page: just the community
 * read model — enough to paint the header (name, DP, member count) on the
 * first server render. Members, permissions and messages hydrate client-side
 * from the request cache (revisits) or a fresh bootstrap fetch, so navigation
 * never blocks on secondary data.
 *
 * Latency profile: exactly TWO database round trips, issued in parallel.
 * The pre-slim version ran ~10 queries across four sequential waves
 * (top-member profiles → experience levels → manager status) and embedded the
 * Lottie animation payload into the RSC response; all of that arrives with the
 * client-side /bootstrap fetch instead.
 */
export async function fetchCommunityMetaSSR(
  communityId: string,
  userId: string,
): Promise<SSRCommunityMeta | null> {
  const db = createServiceClient();

  const [{ data: membership }, { data: community }, { data: currentUser }] = await Promise.all([
    db.from("community_members").select("joined_at, last_read_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("id, name, type, image_url, reference_id, created_at, description, is_private, enabled_tabs, owner_id").eq("id", communityId).maybeSingle(),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
  ]);

  if (!membership || !community) return null;

  const meta: CachedMeta = {
    community: {
      id: community.id, name: community.name, type: community.type,
      // member_count streams in with /bootstrap; omitting it here lets the
      // header fall back to the sidebar entry's count for the first paint.
      member_count: 0,
      image_url: (community as any).image_url ?? null,
      description: (community as any).description ?? null,
      created_at: (community as any).created_at ?? undefined,
      owner_id: (community as any).owner_id ?? null,
      is_private: (community as any).is_private ?? false,
      enabled_tabs: (community as any).enabled_tabs ?? ["chat", "threads", "showcase", "events", "resources"],
      // Role/permissions are not fetched server-side any more; bootstrap
      // overwrites them client-side moments later.
      current_user_role: null,
      current_user_permissions: null,
    },
    members: [],
    fetchedAt: Date.now(),
  };

  return {
    meta,
    lastReadAt: (membership as unknown as { last_read_at: string | null }).last_read_at ?? null,
    currentUserName: currentUser?.name ?? null,
  };
}

export interface SSRCommunityMeta {
  meta: CachedMeta;
  lastReadAt: string | null;
  currentUserName: string | null;
}

/** Kept for the CommunityChat prop contract; sections now always hydrate client-side. */
export interface SSRCommunitySections {
  threads?: unknown;
  events?: unknown;
  resources?: unknown;
  showcase?: unknown;
  members?: unknown;
  rules?: unknown;
}
