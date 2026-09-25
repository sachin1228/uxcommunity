import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_ENABLED_TABS } from "./areas";
import { canStoreShowcaseFlag } from "./showcase-flag";
import { EVENT_CHAT_COMMUNITY_TYPE } from "./event-chat-rules";
import { loadEventRoomMeta } from "./event-chat";
import type { CachedMeta } from "./cache";

/**
 * Lightweight server snapshot for the community chat page: just the community
 * read model — enough to paint the header (name, DP, member count) on the
 * first server render. Members, permissions and messages hydrate client-side
 * from the request cache (revisits) or a fresh bootstrap fetch, so navigation
 * never blocks on secondary data.
 *
 * Latency profile: exactly TWO database round trips, issued in parallel — plus
 * a best-effort pair more, and only for an event's group chat, for the date
 * and pin deadline its header DP wears (see loadEventRoomMeta).
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
    // showcase_enabled is read only once the showcase-toggle migration has
    // added the column, so the first paint works before it is applied. Each
    // branch keeps a single string literal (see read-models.ts).
    (await canStoreShowcaseFlag(db)
      ? db
          .from("communities")
          .select(
            "id, name, type, image_url, reference_id, created_at, description, is_private, enabled_tabs, owner_id, showcase_enabled",
          )
      : db
          .from("communities")
          .select(
            "id, name, type, image_url, reference_id, created_at, description, is_private, enabled_tabs, owner_id",
          ))
      .eq("id", communityId)
      .maybeSingle(),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
  ]);

  if (!membership || !community) return null;

  // An event group chat's DP carries its event's date from the first paint, so
  // the header never shows a badge-less face first and then grows one — and the
  // pin deadline comes with it, so a room that is on right now already reads
  // LIVE before the client fetches anything. (The cast matches this file's
  // untyped supabase-js baseline.)
  const eventRoom = (community as any).type === EVENT_CHAT_COMMUNITY_TYPE
    ? await loadEventRoomMeta(db, communityId).catch(() => null)
    : null;

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
      enabled_tabs: (community as any).enabled_tabs ?? [...DEFAULT_ENABLED_TABS],
      // Absent pre-migration; the tab bar reads that as "Showcase is on".
      showcase_enabled: (community as any).showcase_enabled ?? null,
      event_date: eventRoom?.eventDate ?? null,
      pinned_until: eventRoom?.pinnedUntil ?? null,
      event_end: eventRoom?.eventEnd ?? null,
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
  /** Permanent "<name> created a …" timeline cards seeded with the page. */
  contentEvents?: import("./cache").CachedContentEvent[];
}
