import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { ContentEventKind } from "./cache";

export interface ContentEventRow {
  id: string;
  community_id: string;
  user_id: string;
  kind: ContentEventKind;
  title: string;
  created_at: string;
  users: { name: string; avatar_url: string | null } | null;
}

/**
 * Loads the first page of the community's threads / showcase posts / resources
 * / events with author display info merged in — the data the chat timeline's
 * permanent "John created a …" notification cards are rendered from. The
 * timeline merges these alongside chat messages, so the same fresh-visit
 * window (50 per list) that messages already use applies per kind.
 *
 * Only kinds a member can actually reach are included — callers pass the
 * community's enabled tabs / showcase flag (see areas.ts).
 */
export async function loadCommunityContentEvents(
  communityId: string,
  limits: { threads: boolean; showcase: boolean; events: boolean; resources: boolean },
  perKind = 50,
): Promise<ContentEventRow[]> {
  const db = createServiceClient();

  // Repo-wide untyped supabase-js baseline (see next.config.js): queries are
  // cast, not generated. Promise.all keeps the four lists to one round trip.
  const [threadsRes, showcaseRes, resourcesRes, eventsRes] = await Promise.all([
    limits.threads
      ? db
          .from("community_threads")
          .select("id, community_id, user_id, title, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
    limits.showcase
      ? db
          .from("community_showcase_posts")
          .select("id, community_id, user_id, title, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
    limits.resources
      ? db
          .from("community_resources")
          .select("id, community_id, user_id, title, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
    limits.events
      ? db
          .from("community_events")
          .select("id, community_id, user_id, title, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
  ]);

  const rows: Array<Record<string, unknown>> = [];
  const addRows = (kind: ContentEventKind, result: unknown) => {
    for (const row of ((result as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>) {
      rows.push({ ...row, kind });
    }
  };
  addRows("thread", threadsRes);
  addRows("showcase", showcaseRes);
  addRows("resource", resourcesRes);
  addRows("event", eventsRes);
  if (!rows.length) return [];

  const authorIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => typeof id === "string"))];
  const [{ data: users }, { data: profiles }] = authorIds.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", authorIds),
        db.from("designer_profiles").select("user_id, avatar_url").in("user_id", authorIds),
      ])
    : [{ data: [] }, { data: [] }];

  const nameMap = Object.fromEntries((users ?? []).map((u) => [(u as { id: string }).id, (u as { name: string }).name]));
  const avatarMap = Object.fromEntries((profiles ?? []).map((p) => [(p as { user_id: string }).user_id, (p as { avatar_url: string | null }).avatar_url]));

  return rows
    .map((row) => {
      const authorId = row.user_id as string;
      const name = nameMap[authorId];
      return {
        id: row.id as string,
        community_id: row.community_id as string,
        user_id: authorId,
        kind: row.kind as ContentEventKind,
        title: row.title as string,
        created_at: row.created_at as string,
        users: name
          ? { name, avatar_url: avatarMap[authorId] ?? null }
          : null,
      };
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Broadcast a content creation to the community's chat room. */
export function contentEventPayload(
  row: Record<string, unknown>,
  kind: ContentEventKind,
): Record<string, unknown> {
  return {
    id: row.id,
    community_id: row.community_id,
    user_id: row.user_id,
    kind,
    title: row.title,
    created_at: row.created_at,
  };
}

/** Broadcast a content deletion to the community's chat room. */
export function contentDeletedPayload(
  communityId: string,
  id: string,
  kind: ContentEventKind,
): Record<string, unknown> {
  return { id, community_id: communityId, kind };
}
