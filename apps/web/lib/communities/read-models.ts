import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import {
  getExperienceLevelNameMap,
  getMasterImageMap,
  getMasterNameMap,
  TABLE_LOOKUP,
} from "@/lib/master-data-cache";

const MESSAGE_PAGE_SIZE = 50;

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

export async function loadCommunityReadModel(
  communityId: string,
  userId: string,
): Promise<ReadResult<Record<string, unknown>>> {
  const db = createServiceClient();
  const [{ data: membership }, { data: community, error: communityError }] = await Promise.all([
    db.from("community_members").select("joined_at, role").eq("community_id", communityId).eq("user_id", userId).maybeSingle(),
    db.from("communities").select("id, name, type, image_url, description, reference_id, created_at, is_private, enabled_tabs, owner_id, invite_token").eq("id", communityId).eq("is_active", true).maybeSingle(),
  ]);

  if (!membership) return { ok: false, status: 403, error: "Not a member of this community." };
  if (communityError || !community) return { ok: false, status: 404, error: "Community not found." };

  const hasMasterData = Boolean(TABLE_LOOKUP[community.type]);
  const [masterImageMap, masterNameMap, experienceLevelNameMap, { data: memberRows, count: memberCount }] = await Promise.all([
    hasMasterData ? getMasterImageMap(community.type) : Promise.resolve({} as Record<string, string | null>),
    hasMasterData ? getMasterNameMap(community.type) : Promise.resolve({} as Record<string, string>),
    getExperienceLevelNameMap(),
    db.from("community_members").select("user_id, joined_at, role", { count: "exact" }).eq("community_id", communityId).order("joined_at", { ascending: false }).limit(10),
  ]);

  const memberUserIds = (memberRows ?? []).map((member) => member.user_id);
  const [{ data: memberUsers }, { data: memberProfiles }] = memberUserIds.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", memberUserIds),
        db.from("designer_profiles").select("user_id, avatar_url, experience_level, companies(name)").in("user_id", memberUserIds),
      ])
    : [{ data: [] }, { data: [] }];

  const userMap = Object.fromEntries((memberUsers ?? []).map((user) => [user.id, user]));
  const profileMap = Object.fromEntries((memberProfiles ?? []).map((profile) => [profile.user_id, profile]));
  const members = (memberRows ?? []).map((member) => {
    const profile = profileMap[member.user_id] as any;
    const user = userMap[member.user_id] as any;
    return {
      user_id: member.user_id,
      joined_at: member.joined_at,
      role: member.role ?? "member",
      users: user ? {
        name: user.name,
        avatar_url: profile?.avatar_url ?? null,
        designation: profile?.experience_level
          ? cleanDesignation(experienceLevelNameMap[profile.experience_level] ?? profile.experience_level)
          : null,
        company: profile?.companies?.name ?? null,
      } : null,
    };
  });

  return {
    ok: true,
    data: {
      community: {
        ...community,
        image_url: (community.reference_id ? masterImageMap[community.reference_id] : undefined) ?? community.image_url ?? null,
        reference_name: (community.reference_id ? masterNameMap[community.reference_id] : undefined) ?? null,
        member_count: memberCount ?? 0,
        invite_token: community.owner_id === userId ? community.invite_token : undefined,
      },
      members,
      current_user_role: membership.role ?? "member",
    },
  };
}

export async function loadCommunityMessagePage(
  communityId: string,
  userId: string,
  cursors: { before?: string | null; after?: string | null } = {},
): Promise<ReadResult<{ messages: unknown[] }>> {
  const db = createServiceClient();
  const { data: membership, error: membershipError } = await db
    .from("community_members")
    .select("joined_at, history_cleared_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) return { ok: false, status: 500, error: "Failed to verify community membership." };
  if (!membership) return { ok: false, status: 403, error: "Not a member of this community." };

  const historyStart = membership.history_cleared_at && membership.history_cleared_at > membership.joined_at
    ? membership.history_cleared_at
    : membership.joined_at;
  const { data, error } = await callPerformanceRpc(db, "get_community_message_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_history_start: historyStart,
    p_before: cursors.after ? null : (cursors.before ?? null),
    p_after: cursors.after ?? null,
    p_limit: MESSAGE_PAGE_SIZE,
  });

  if (error) return { ok: false, status: 500, error: "Failed to fetch messages." };
  return { ok: true, data: { messages: (data ?? []).reverse() } };
}
