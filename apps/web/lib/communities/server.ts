import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { CachedMeta } from "./cache";
import { loadCommunityChatReadModel } from "./chat-read-model";

/** Access-checked header and read marker only. Full community details hydrate
 * after messages paint, including member previews, About, grants and mute. */
export async function fetchCommunityMetaSSR(
  communityId: string,
  userId: string,
): Promise<SSRCommunityMeta | null> {
  const db = createServiceClient();
  const [snapshot, { data: currentUser }] = await Promise.all([
    loadCommunityChatReadModel(communityId, userId),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
  ]);
  if (!snapshot.ok) return null;
  return {
    meta: { community: snapshot.data.community, members: [], fetchedAt: Date.now() },
    lastReadAt: snapshot.data.lastReadAt,
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
