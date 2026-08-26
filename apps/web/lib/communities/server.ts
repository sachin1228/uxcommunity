import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { getMasterImageMap, TABLE_LOOKUP } from "@/lib/master-data-cache";
import type { CachedMeta } from "./cache";

/**
 * Strip year-range suffixes and singularize experience level names for display.
 * e.g. "Mid-Level Designers (3-5 years)" → "Mid-Level Designer"
 *      "Heads of Design"                 → "Head of Design"
 */
function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

export interface SSRCommunitySections {
  threads?: unknown;
  events?: unknown;
  resources?: unknown;
  showcase?: unknown;
  members?: unknown;
  rules?: unknown;
  stats?: unknown;
}

export interface SSRCommunityMeta {
  meta: CachedMeta;
  lastReadAt: string | null;
}

/**
 * Lightweight server snapshot for the community chat page: just the community
 * read model + top members — enough to paint the header and the info panel on
 * the first server render. Messages and tab sections hydrate client-side from
 * the request cache (revisits) or a fresh bootstrap fetch (with the Lottie
 * loader in the chat while it loads), so navigation never blocks on the full
 * read model.
 */
export async function fetchCommunityMetaSSR(
  communityId: string,
  userId: string,
): Promise<SSRCommunityMeta | null> {
  const db = createServiceClient();

  const [
    { data: membership },
    { data: community },
    { count: memberCount },
    { data: memberRows },
  ] = await Promise.all([
    db.from("community_members").select("joined_at, last_read_at").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("id, name, type, image_url, reference_id, created_at, description, is_private, enabled_tabs, owner_id").eq("id", communityId).maybeSingle(),
    db.from("community_members").select("*", { count: "exact", head: true }).eq("community_id", communityId),
    db.from("community_members").select("user_id, joined_at").eq("community_id", communityId).order("joined_at", { ascending: false }).limit(10),
  ]);

  if (!membership || !community) return null;

  const masterImgMap = TABLE_LOOKUP[community.type as string]
    ? await getMasterImageMap(community.type as string)
    : ({} as Record<string, string | null>);

  const resolvedImageUrl: string | null =
    (community.reference_id ? masterImgMap[community.reference_id] : undefined) ??
    (community as any).image_url ?? null;

  // Top members for the info panel.
  const memberUserIds = (memberRows ?? []).map((m) => m.user_id);
  const [{ data: memberUsers }, { data: memberProfiles }] = memberUserIds.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", memberUserIds),
        db.from("designer_profiles").select("user_id, avatar_url, experience_level").in("user_id", memberUserIds),
      ])
    : [
        { data: [] as { id: string; name: string }[] },
        { data: [] as { user_id: string; avatar_url: string | null; experience_level: string | null; companies: { name: string } | null }[] },
      ];

  // Resolve experience level slugs in one batch query.
  const allSlugs = [...new Set((memberProfiles ?? []).map((p: any) => p.experience_level).filter(Boolean) as string[])];
  const expLevelMap: Record<string, string> = {};
  if (allSlugs.length) {
    const { data: levels } = await db.from("experience_levels").select("slug, name").in("slug", allSlugs);
    for (const l of levels ?? []) expLevelMap[l.slug] = cleanDesignation(l.name);
  }

  const memberUserMap    = Object.fromEntries((memberUsers ?? []).map((u) => [u.id, u.name]));
  const memberProfileMap = Object.fromEntries((memberProfiles ?? []).map((p: any) => [p.user_id, p]));
  const members: CachedMeta["members"] = (memberRows ?? []).map((m) => {
    const p = memberProfileMap[m.user_id];
    return {
      user_id: m.user_id,
      users: memberUserMap[m.user_id]
        ? {
            name:        memberUserMap[m.user_id],
            avatar_url:  p?.avatar_url ?? null,
            designation: p?.experience_level ? (expLevelMap[p.experience_level] ?? null) : null,
          }
        : null,
    };
  });

  const meta: CachedMeta = {
    community: {
      id: community.id, name: community.name, type: community.type,
      member_count: memberCount ?? 0, image_url: resolvedImageUrl,
      description: (community as any).description ?? null,
      created_at: (community as any).created_at ?? undefined,
      owner_id: (community as any).owner_id ?? null,
      is_private: (community as any).is_private ?? false,
      enabled_tabs: (community as any).enabled_tabs ?? ["chat", "threads", "events", "resources"],
    },
    members,
    fetchedAt: Date.now(),
  };

  return {
    meta,
    lastReadAt: (membership as unknown as { last_read_at: string | null }).last_read_at ?? null,
  };
}
