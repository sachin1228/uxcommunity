import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { ContentEventKind } from "./cache";
import type { ContentEventMeta } from "./content-notifications";
import { loadRsvpCounts } from "./content-notifications";

export interface ContentEventRow {
  id: string;
  community_id: string;
  user_id: string;
  kind: ContentEventKind;
  title: string;
  created_at: string;
  users: { name: string; avatar_url: string | null } | null;
  /** Rich fields (thumbnail, description, schedule…) the chat card renders. */
  meta?: ContentEventMeta | null;
}

/** First image attachment (or null) from a thread/showcase attachment list. */
function firstImageUrl(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments as Array<Record<string, unknown>>) {
    if (typeof a?.url !== "string") continue;
    if (typeof a?.type === "string" && a.type.startsWith("image/")) return a.url;
  }
  return null;
}

/** First video attachment's poster frame (or null). */
function firstVideoPoster(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments as Array<Record<string, unknown>>) {
    if (typeof a?.poster === "string" && a.poster) return a.poster;
  }
  return null;
}

/** Per-kind rich fields embedded into the broadcast/persisted event payload. */
function metaFor(kind: ContentEventKind, row: Record<string, unknown>): ContentEventMeta {
  switch (kind) {
    case "thread":
      return {
        image_url: firstImageUrl(row.attachments),
        video_poster: firstVideoPoster(row.attachments),
        description: typeof row.title === "string" && row.title ? row.title : null,
      };
    case "showcase":
      return {
        image_url: typeof row.image_url === "string" ? row.image_url : firstImageUrl(row.attachments),
        video_poster: firstVideoPoster(row.attachments),
      };
    case "resource":
      return {
        resource_type: typeof row.resource_type === "string" ? row.resource_type : null,
        url: typeof row.url === "string" ? row.url : null,
        description: typeof row.description === "string" ? row.description : null,
      };
    case "event":
      return {
        image_url: typeof row.cover_image_url === "string" ? row.cover_image_url : null,
        description: typeof row.description === "string" ? row.description : null,
        event_date: typeof row.event_date === "string" ? row.event_date : null,
        end_date: typeof row.end_date === "string" ? row.end_date : null,
        is_online: row.is_online === true,
        rsvp_count: 0,
      };
  }
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
          .select("id, community_id, user_id, title, attachments, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
    limits.showcase
      ? db
          .from("community_showcase_posts")
          .select("id, community_id, user_id, title, image_url, attachments, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
    limits.resources
      ? db
          .from("community_resources")
          .select("id, community_id, user_id, title, description, resource_type, url, created_at")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(perKind)
      : Promise.resolve(null),
    limits.events
      ? db
          .from("community_events")
          .select("id, community_id, user_id, title, description, event_date, end_date, is_online, cover_image_url, created_at")
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

  // RSVPs change independently of the event row, so the embedded count goes
  // stale — refresh it for the events on this page in one query.
  const eventRows = rows.filter((row) => row.kind === "event");
  const rsvpCounts = await loadRsvpCounts(
    db,
    eventRows.map((row) => row.id as string),
  );

  return rows
    .map((row) => {
      const authorId = row.user_id as string;
      const name = nameMap[authorId];
      const kind = row.kind as ContentEventKind;
      const meta = metaFor(kind, row);
      if (kind === "event") meta.rsvp_count = rsvpCounts.get(row.id as string) ?? 0;
      return {
        id: row.id as string,
        community_id: row.community_id as string,
        user_id: authorId,
        kind,
        title: row.title as string,
        created_at: row.created_at as string,
        meta,
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
    meta: metaFor(kind, row),
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
