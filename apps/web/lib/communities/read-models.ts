import "server-only";

import { cache } from "react";
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

export const loadCommunityReadModel = cache(async function loadCommunityReadModel(
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
});

export type CommunityBootstrapMembership = {
  joined_at: string;
  history_cleared_at: string | null;
  last_read_at: string | null;
  role: string | null;
};

type DatabaseMeasure = <T>(name: string, operation: () => Promise<T>) => Promise<T>;

const measureDirectly: DatabaseMeasure = async (_name, operation) => operation();

/**
 * Critical first-render metadata only. Keep this path free of member lists,
 * counts, profile joins, master-data lookups, and secondary-section RPCs.
 */
export async function loadCommunityBootstrapReadModel(
  communityId: string,
  userId: string,
  measure: DatabaseMeasure = measureDirectly,
): Promise<ReadResult<{
  community: Record<string, unknown>;
  members: [];
  current_user_role: string;
  membership: CommunityBootstrapMembership;
}>> {
  const db = createServiceClient();
  const [membershipResult, communityResult] = await Promise.all([
    measure("db_membership", async () => await db
      .from("community_members")
      .select("joined_at, history_cleared_at, last_read_at, role")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle()),
    measure("db_community", async () => await db
      .from("communities")
      .select("id, name, type, image_url, description, reference_id, created_at, is_private, enabled_tabs, owner_id, invite_token")
      .eq("id", communityId)
      .eq("is_active", true)
      .maybeSingle()),
  ]);

  const { data: membership, error: membershipError } = membershipResult;
  const { data: community, error: communityError } = communityResult;
  if (membershipError) return { ok: false, status: 500, error: "Failed to verify community membership." };
  if (!membership) return { ok: false, status: 403, error: "Not a member of this community." };
  if (communityError || !community) return { ok: false, status: 404, error: "Community not found." };

  return {
    ok: true,
    data: {
      community: {
        ...community,
        member_count: 0,
        invite_token: community.owner_id === userId ? community.invite_token : undefined,
      },
      // Retained for response compatibility; member data is loaded lazily.
      members: [],
      current_user_role: membership.role ?? "member",
      membership: membership as CommunityBootstrapMembership,
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
  const { data, error } = await callPerformanceRpc(createServiceClient(), "get_thread_list_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_limit: 50,
  });
  if (error?.code === "42501") return { ok: false, status: 403, error: "Not a member of this community." };
  if (error) return { ok: false, status: 500, error: "Failed to fetch threads." };
  return { ok: true, data: { threads: (data ?? []).map(({ item }) => item) } };
}

export async function loadCommunityResources(
  communityId: string,
  userId: string,
): Promise<ReadResult<{ resources: unknown[] }>> {
  const { data, error } = await callPerformanceRpc(createServiceClient(), "get_resource_list_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_limit: 100,
  });
  if (error?.code === "42501") return { ok: false, status: 403, error: "Not a member of this community." };
  if (error) return { ok: false, status: 500, error: "Failed to fetch resources." };
  return { ok: true, data: { resources: (data ?? []).map(({ item }) => item) } };
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

export async function loadCommunityEvents(
  communityId: string,
  userId: string,
): Promise<ReadResult<{ events: unknown[]; nextCursor: string | null }>> {
  const now = new Date().toISOString();
  const fetchPhase = (phase: "upcoming" | "past") =>
    callPerformanceRpc(createServiceClient(), "get_event_list_page", {
      p_community_id: communityId,
      p_user_id: userId,
      p_phase: phase,
      p_cursor_event_date: null,
      p_cursor_id: null,
      p_now: now,
      p_limit: 26,
    });

  let phase: "upcoming" | "past" = "upcoming";
  let result = await fetchPhase(phase);
  if (!result.error && (result.data?.length ?? 0) === 0) {
    phase = "past";
    result = await fetchPhase(phase);
  }
  if (result.error?.code === "42501") return { ok: false, status: 403, error: "Not a member." };
  if (result.error) return { ok: false, status: 500, error: "Failed to fetch events." };

  const events = (result.data ?? []).slice(0, 25).map(({ item }) => item);
  const last = events.at(-1) as Record<string, unknown> | undefined;
  const nextCursor = (result.data?.length ?? 0) > 25 && last
    ? `${phase}|${last.event_date as string}|${last.id as string}`
    : phase === "upcoming" ? "past" : null;
  return { ok: true, data: { events, nextCursor } };
}

export async function loadCommunityMembersPage(
  communityId: string,
  userId: string,
): Promise<ReadResult<{ members: unknown[]; has_more: boolean; total: number }>> {
  const db = createServiceClient();
  if (!(await isCommunityMember(communityId, userId))) {
    return { ok: false, status: 403, error: "Not a member." };
  }
  const { data: rows, error } = await db
    .from("community_members")
    .select("user_id, joined_at, role")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });
  if (error) return { ok: false, status: 500, error: "Failed to load members." };

  const allRows = (rows ?? []) as Array<{ user_id: string; joined_at: string; role: string | null }>;
  const pageRows = allRows.slice(0, 30);
  const ids = pageRows.map((row) => row.user_id);
  const [{ data: users }, { data: profiles }, experienceLevelNameMap] = ids.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", ids),
        db.from("designer_profiles").select("user_id, avatar_url, experience_level, companies(name)").in("user_id", ids),
        getExperienceLevelNameMap(),
      ])
    : [{ data: [] }, { data: [] }, {} as Record<string, string>];
  const userRows = (users ?? []) as Array<{ id: string; name: string }>;
  const profileRows = (profiles ?? []) as Array<{
    user_id: string;
    avatar_url: string | null;
    experience_level: string | null;
    companies: { name: string } | null;
  }>;
  const userMap = Object.fromEntries(userRows.map((user) => [user.id, user]));
  const profileMap = Object.fromEntries(profileRows.map((profile) => [profile.user_id, profile]));
  const members = pageRows.flatMap((row) => {
    const user = userMap[row.user_id] as any;
    const profile = profileMap[row.user_id] as any;
    return user ? [{
      user_id: row.user_id,
      joined_at: row.joined_at,
      role: row.role ?? "member",
      name: user.name,
      avatar_url: profile?.avatar_url ?? null,
      designation: profile?.experience_level
        ? cleanDesignation(experienceLevelNameMap[profile.experience_level] ?? profile.experience_level)
        : null,
      company: profile?.companies?.name ?? null,
    }] : [];
  });
  return { ok: true, data: { members, has_more: allRows.length > 30, total: allRows.length } };
}

export async function loadCommunityRules(
  communityId: string,
): Promise<ReadResult<{ rules: unknown[] }>> {
  const { data, error } = await createServiceClient()
    .from("community_rules")
    .select("id, rule_text, order_index")
    .eq("community_id", communityId)
    .order("order_index", { ascending: true });
  if (error) return { ok: false, status: 500, error: "Failed to load rules." };
  return { ok: true, data: { rules: data ?? [] } };
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
  options: {
    membership?: Pick<CommunityBootstrapMembership, "joined_at" | "history_cleared_at">;
    measure?: DatabaseMeasure;
  } = {},
): Promise<ReadResult<{ messages: unknown[] }>> {
  const db = createServiceClient();
  const measure = options.measure ?? measureDirectly;
  let membership = options.membership;

  if (!membership) {
    const { data, error } = await measure("db_membership", async () => await db
      .from("community_members")
      .select("joined_at, history_cleared_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle());
    if (error) return { ok: false, status: 500, error: "Failed to verify community membership." };
    if (!data) return { ok: false, status: 403, error: "Not a member of this community." };
    membership = data;
  }

  const historyStart = membership.history_cleared_at && membership.history_cleared_at > membership.joined_at
    ? membership.history_cleared_at
    : membership.joined_at;
  const { data, error } = await measure("db_messages", () => callPerformanceRpc(db, "get_community_message_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_history_start: historyStart,
    p_before: cursors.after ? null : (cursors.before ?? null),
    p_after: cursors.after ?? null,
    p_limit: MESSAGE_PAGE_SIZE,
  }));

  if (error) return { ok: false, status: 500, error: "Failed to fetch messages." };
  return { ok: true, data: { messages: (data ?? []).reverse() } };
}
