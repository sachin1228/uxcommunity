import "server-only";

import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import {
  getExperienceLevelNameMap,
  getMasterNameMap,
  TABLE_LOOKUP,
} from "@/lib/master-data-cache";
import { resolveCommunityDp } from "./dp";

const MESSAGE_PAGE_SIZE = 50;

/**
 * Cloudflare's request pipeline decodes a literal `+` inside a query-string
 * value as a space. A PostgREST UTC offset like "2026-08-15T10:00:00.123+00:00"
 * therefore reaches route handlers as "2026-08-15T10:00:00.123 00:00" — a string
 * Postgres cannot parse, which turned chat/thread/resource/showcase pagination
 * into a permanent 500 (and an endless retry spinner in the chat). Normalize
 * both the canonical ("+00:00" / "Z") and mangled (" 00:00") forms to a single
 * "Z" suffix so the RPC always receives a parseable timestamptz.
 */
export function normalizeUtcCursor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\+00:00| 00:00|Z)$/.exec(value.trim());
  return match ? `${match[1]}Z` : null;
}

/** Serialize a PostgREST timestamptz ("…+00:00") as the "…Z" form used in cursors. */
export function toUtcCursor(value: string): string {
  return value.endsWith("+00:00") ? `${value.slice(0, -6)}Z` : value;
}

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
    db.from("communities").select("id, name, type, image_url, description, reference_id, created_at, is_private, enabled_tabs, owner_id, invite_token, lottie_url, lottie_format").eq("id", communityId).eq("is_active", true).maybeSingle(),
  ]);

  if (!membership) return { ok: false, status: 403, error: "Not a member of this community." };
  if (communityError || !community) return { ok: false, status: 404, error: "Community not found." };

  const hasMasterData = Boolean(TABLE_LOOKUP[community.type]);
  const [dp, masterNameMap, experienceLevelNameMap, { data: memberRows, count: memberCount }] = await Promise.all([
    resolveCommunityDp({
      type: community.type,
      reference_id: community.reference_id,
      image_url: community.image_url ?? null,
      lottie_url: community.lottie_url ?? null,
      lottie_format: community.lottie_format ?? null,
      embedLottie: true,
    }),
    hasMasterData ? getMasterNameMap(community.type) : Promise.resolve({} as Record<string, string>),
    getExperienceLevelNameMap(),
    db.from("community_members").select("user_id, joined_at, role", { count: "exact" }).eq("community_id", communityId).order("joined_at", { ascending: false }).limit(10),
  ]);

  const memberUserIds = (memberRows ?? []).map((member) => member.user_id);
  const [{ data: memberUsers }, { data: memberProfiles }] = memberUserIds.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", memberUserIds),
        db.from("designer_profiles").select("user_id, avatar_url, experience_level").in("user_id", memberUserIds),
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
      } : null,
    };
  });

  return {
    ok: true,
    data: {
      community: {
        ...community,
        image_url: dp.image_url,
        lottie_url: dp.lottie_url,
        lottie_format: dp.lottie_format,
        lottie_data: dp.lottie_data,
        reference_name: (community.reference_id ? masterNameMap[community.reference_id] : undefined) ?? null,
        member_count: memberCount ?? 0,
        invite_token: community.owner_id === userId ? community.invite_token : undefined,
      },
      members,
      current_user_role: membership.role ?? "member",
    },
  };
});

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
  cursor: string | null = null,
): Promise<ReadResult<{ threads: unknown[]; nextCursor: string | null }>> {
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    [cursorCreatedAt, cursorId] = cursor.split("|");
    if (!cursorCreatedAt || !cursorId) {
      return { ok: false, status: 400, error: "Invalid cursor." };
    }
    cursorCreatedAt = normalizeUtcCursor(cursorCreatedAt);
    if (!cursorCreatedAt) {
      return { ok: false, status: 400, error: "Invalid cursor." };
    }
  }
  const { data, error } = await callPerformanceRpc(createServiceClient(), "get_thread_list_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_before: cursorCreatedAt,
    p_cursor_id: cursorId,
    p_limit: 51,
  });
  if (error?.code === "42501") return { ok: false, status: 403, error: "Not a member of this community." };
  if (error) return { ok: false, status: 500, error: "Failed to fetch threads." };
  const rows = (data ?? []) as Array<{ item: Record<string, unknown> }>;
  const threads = rows.slice(0, 50).map(({ item }) => item);
  const last = threads.at(-1) as Record<string, unknown> | undefined;
  return {
    ok: true,
    data: {
      threads,
      nextCursor: rows.length > 50 && last ? `${toUtcCursor(last.created_at as string)}|${last.id as string}` : null,
    },
  };
}

export async function loadCommunityResources(
  communityId: string,
  userId: string,
  cursor: string | null = null,
): Promise<ReadResult<{ resources: unknown[]; nextCursor: string | null }>> {
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    [cursorCreatedAt, cursorId] = cursor.split("|");
    if (!cursorCreatedAt || !cursorId) {
      return { ok: false, status: 400, error: "Invalid cursor." };
    }
    cursorCreatedAt = normalizeUtcCursor(cursorCreatedAt);
    if (!cursorCreatedAt) {
      return { ok: false, status: 400, error: "Invalid cursor." };
    }
  }
  const { data, error } = await callPerformanceRpc(createServiceClient(), "get_resource_list_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_before: cursorCreatedAt,
    p_cursor_id: cursorId,
    p_limit: 101,
  });
  if (error?.code === "42501") return { ok: false, status: 403, error: "Not a member of this community." };
  if (error) return { ok: false, status: 500, error: "Failed to fetch resources." };
  const rows = (data ?? []) as Array<{ item: Record<string, unknown> }>;
  const resources = rows.slice(0, 100).map(({ item }) => item);
  const last = resources.at(-1) as Record<string, unknown> | undefined;
  return {
    ok: true,
    data: {
      resources,
      nextCursor: rows.length > 100 && last ? `${toUtcCursor(last.created_at as string)}|${last.id as string}` : null,
    },
  };
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
    if (!cursorCreatedAt || !cursorId) {
      return { ok: false, status: 400, error: "Invalid cursor." };
    }
    cursorCreatedAt = normalizeUtcCursor(cursorCreatedAt);
    if (!cursorCreatedAt) {
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
      nextCursor: (data?.length ?? 0) > 25 && last ? `${toUtcCursor(last.created_at as string)}|${last.id as string}` : null,
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
        db.from("designer_profiles").select("user_id, avatar_url, experience_level").in("user_id", ids),
        getExperienceLevelNameMap(),
      ])
    : [{ data: [] }, { data: [] }, {} as Record<string, string>];
  const userRows = (users ?? []) as Array<{ id: string; name: string }>;
  const profileRows = (profiles ?? []) as Array<{
    user_id: string;
    avatar_url: string | null;
    experience_level: string | null;
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
  const before = normalizeUtcCursor(cursors.before);
  const after = normalizeUtcCursor(cursors.after);
  if ((cursors.before && !before) || (cursors.after && !after)) {
    return { ok: false, status: 400, error: "Invalid cursor." };
  }
  const { data, error } = await callPerformanceRpc(db, "get_community_message_page", {
    p_community_id: communityId,
    p_user_id: userId,
    p_history_start: historyStart,
    p_before: after ? null : before,
    p_after: after,
    p_limit: MESSAGE_PAGE_SIZE,
  });

  if (error) return { ok: false, status: 500, error: "Failed to fetch messages." };
  return { ok: true, data: { messages: (data ?? []).reverse() } };
}
