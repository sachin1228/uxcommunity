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

export async function isCommunityMember(
  communityId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await createServiceClient()
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function enrichAuthoredRows(
  rows: Array<Record<string, unknown>>,
  currentUserId: string,
  aggregateRpc: "get_event_list_aggregates" | "get_thread_list_aggregates" | "get_resource_list_aggregates",
  idsArgument: "p_event_ids" | "p_thread_ids" | "p_resource_ids",
) {
  if (!rows.length) return [];
  const db = createServiceClient();
  const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => typeof id === "string"))];
  const [{ data: users }, { data: profiles }, aggregateResult] = await Promise.all([
    db.from("users").select("id, name").in("id", userIds),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
    callPerformanceRpc(db, aggregateRpc, { p_user_id: currentUserId, [idsArgument]: ids }),
  ]);
  if (aggregateResult.error) throw new Error(`Failed to load ${aggregateRpc} read model.`);
  const userMap = Object.fromEntries((users ?? []).map((user) => [user.id, user.name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.avatar_url]));
  const aggregateMap = new Map((aggregateResult.data ?? []).map((aggregate) => [aggregate.id, aggregate]));
  return rows.map((row) => ({
    ...row,
    users: userMap[row.user_id as string]
      ? { name: userMap[row.user_id as string], avatar_url: avatarMap[row.user_id as string] ?? null }
      : null,
    ...(aggregateMap.get(row.id as string) ?? {}),
  }));
}

export const enrichCommunityEvents = (rows: Array<Record<string, unknown>>, userId: string) =>
  enrichAuthoredRows(rows, userId, "get_event_list_aggregates", "p_event_ids");
export const enrichCommunityThreads = (rows: Array<Record<string, unknown>>, userId: string) =>
  enrichAuthoredRows(rows, userId, "get_thread_list_aggregates", "p_thread_ids");
export const enrichCommunityResources = (rows: Array<Record<string, unknown>>, userId: string) =>
  enrichAuthoredRows(rows, userId, "get_resource_list_aggregates", "p_resource_ids");

export async function loadCommunityThreads(
  communityId: string,
  userId: string,
): Promise<ReadResult<{ threads: unknown[] }>> {
  if (!(await isCommunityMember(communityId, userId))) return { ok: false, status: 403, error: "Not a member of this community." };
  const { data, error } = await createServiceClient()
    .from("community_threads")
    .select("id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, created_at, updated_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, status: 500, error: "Failed to fetch threads." };
  return { ok: true, data: { threads: await enrichCommunityThreads((data ?? []) as Array<Record<string, unknown>>, userId) } };
}

export async function loadCommunityResources(
  communityId: string,
  userId: string,
): Promise<ReadResult<{ resources: unknown[] }>> {
  if (!(await isCommunityMember(communityId, userId))) return { ok: false, status: 403, error: "Not a member of this community." };
  const { data, error } = await createServiceClient()
    .from("community_resources")
    .select("id, community_id, user_id, title, description, resource_type, url, tags, created_at, updated_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, status: 500, error: "Failed to fetch resources." };
  return { ok: true, data: { resources: await enrichCommunityResources((data ?? []) as Array<Record<string, unknown>>, userId) } };
}

export async function loadCommunityShowcasePage(
  communityId: string,
  userId: string,
  cursor: string | null,
): Promise<ReadResult<{ posts: unknown[]; nextCursor: string | null }>> {
  if (!(await isCommunityMember(communityId, userId))) return { ok: false, status: 403, error: "Not a member." };
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    [cursorCreatedAt, cursorId] = cursor.split("|");
    if (!cursorCreatedAt || !cursorId || Number.isNaN(Date.parse(cursorCreatedAt))) {
      return { ok: false, status: 400, error: "Invalid cursor." };
    }
  }
  const { data, error } = await callPerformanceRpc(createServiceClient(), "get_showcase_list_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_cursor_created_at: cursorCreatedAt,
    p_cursor_id: cursorId,
    p_limit: 26,
  });
  if (error) return { ok: false, status: 500, error: "Failed to load showcase posts." };
  const posts = (data ?? []).slice(0, 25) as Array<Record<string, unknown>>;
  const last = posts.at(-1);
  return {
    ok: true,
    data: {
      posts,
      nextCursor: (data?.length ?? 0) > 25 && last ? `${last.created_at as string}|${last.id as string}` : null,
    },
  };
}

export async function loadCommunityStats(communityId: string): Promise<ReadResult<{ posts_today: number }>> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await createServiceClient()
    .from("community_messages")
    .select("*", { count: "exact", head: true })
    .eq("community_id", communityId)
    .is("deleted_at", null)
    .gte("created_at", todayStart.toISOString());
  if (error) return { ok: false, status: 500, error: "Failed to load community stats." };
  return { ok: true, data: { posts_today: count ?? 0 } };
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
