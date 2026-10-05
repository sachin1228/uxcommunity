import "server-only";

/**
 * One removal path for community content (thread, showcase post, resource,
 * event), shared by the author/manager DELETE routes and the admin dashboard's
 * report review.
 *
 * The caller keeps the authorization story (author, manager permission, or
 * platform admin) and the content-specific side effects (audit trail,
 * notifications); this module owns the mutation itself: delete the row, unlink
 * an event's group chat, reclaim the R2 objects it owned, and announce the
 * change over realtime — in that order, so every removal behaves identically
 * no matter who asked for it.
 */

import {
  SHOWCASE_ATTACHMENT_LOOKUP,
  SHOWCASE_POSTER_LOOKUP,
  THREAD_ATTACHMENT_LOOKUP,
  attachmentPosterUrls,
  attachmentUrls,
} from "@uxcommunity/shared";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import type { createServiceClient } from "@/lib/supabase/service";

export type RemovableContentKind = "thread" | "showcase" | "resource" | "event";

export interface RemovedContentInfo {
  kind: RemovableContentKind;
  id: string;
  userId: string;
  communityId: string | null;
  title: string | null;
}

export interface RemoveContentResult {
  ok: boolean;
  /** False when the row was already gone (or never existed). */
  removed: boolean;
  content: RemovedContentInfo | null;
  /** For events: the group chat community that was unlinked from the event. */
  chatCommunityId: string | null;
  error?: unknown;
}

type Db = ReturnType<typeof createServiceClient>;

interface ContentRow {
  id: string;
  user_id: string;
  community_id: string | null;
  title: string | null;
  attachments?: unknown;
  image_url?: string | null;
  cover_image_url?: string | null;
}

const CONTENT_TABLES = {
  thread: "community_threads",
  showcase: "community_showcase_posts",
  resource: "community_resources",
  event: "community_events",
} as const;

async function loadContentRow(db: Db, kind: RemovableContentKind, id: string) {
  switch (kind) {
    case "thread":
      return db
        .from("community_threads")
        .select("id, user_id, community_id, title, attachments")
        .eq("id", id)
        .maybeSingle();
    case "showcase":
      return db
        .from("community_showcase_posts")
        .select("id, user_id, community_id, title, image_url, attachments")
        .eq("id", id)
        .maybeSingle();
    case "resource":
      return db
        .from("community_resources")
        .select("id, user_id, community_id, title")
        .eq("id", id)
        .maybeSingle();
    case "event":
      return db
        .from("community_events")
        .select("id, user_id, community_id, title, cover_image_url")
        .eq("id", id)
        .maybeSingle();
  }
}

/** Reclaim the R2 objects this row owned; best-effort, like the delete routes. */
async function cleanupContentMedia(db: Db, kind: RemovableContentKind, row: ContentRow) {
  if (kind === "thread") {
    for (const url of attachmentUrls(row.attachments)) {
      await deleteR2AssetIfUnreferenced(db, url, [THREAD_ATTACHMENT_LOOKUP]);
    }
    return;
  }

  if (kind === "showcase") {
    for (const url of attachmentUrls(row.attachments)) {
      await deleteR2AssetIfUnreferenced(db, url, [SHOWCASE_ATTACHMENT_LOOKUP]);
    }
    // Posters live at their own R2 keys — orphan them with their video.
    for (const posterUrl of attachmentPosterUrls(row.attachments)) {
      await deleteR2AssetIfUnreferenced(db, posterUrl, [SHOWCASE_POSTER_LOOKUP]);
    }
    await deleteR2AssetIfUnreferenced(db, row.image_url, [
      { table: "community_showcase_posts", column: "image_url" },
    ]);
    return;
  }

  if (kind === "event") {
    // communities.image_url is checked too: the event's group chat wears the
    // event's cover as its own DP, and that room outlives the event.
    await deleteR2AssetIfUnreferenced(db, row.cover_image_url, [
      { table: "community_events", column: "cover_image_url" },
      { table: "communities", column: "image_url" },
    ]);
  }
}

/** Announce the removal to every room that renders the content. */
function announceRemoval(
  kind: RemovableContentKind,
  id: string,
  scope: string,
  chatCommunityId: string | null,
) {
  const announcements: Array<{ room: string; topic: string; data: unknown }> = [];

  if (kind === "thread") {
    announcements.push(
      { room: realtimeRooms.threads(scope), topic: "thread", data: { id } },
      { room: realtimeRooms.chat(scope), topic: "thread-delete", data: { id } },
    );
  } else if (kind === "resource") {
    announcements.push({ room: realtimeRooms.resources(scope), topic: "resource", data: { id } });
  } else if (kind === "event") {
    announcements.push({ room: realtimeRooms.events(scope), topic: "event", data: { id } });
  }

  // Remove the timeline's permanent "created a …" card too.
  announcements.push({
    room: realtimeRooms.chat(scope),
    topic: "content-delete",
    data: { id, community_id: scope, kind },
  });

  if (kind === "event" && chatCommunityId) {
    // The room's own members: the date badge on its DP and the Event card
    // beside its chat both read the link that just went away.
    announcements.push(
      { room: realtimeRooms.events(chatCommunityId), topic: "event", data: { id } },
      {
        room: realtimeRooms.chat(chatCommunityId),
        topic: "content-delete",
        data: { id, community_id: chatCommunityId, kind },
      },
    );
  }

  void publishRealtimeBatch(announcements);
}

/**
 * Removes one content row plus everything that hung off it. `scope` is the
 * route scope used for realtime rooms — a community id, or the public-content
 * scope for content that lives outside any community.
 *
 * Returns `removed: false` (still `ok`) when the row is already gone: callers
 * can then skip a removal notice but still resolve reports pointing at it.
 */
export async function removeCommunityContent(
  db: Db,
  input: { kind: RemovableContentKind; id: string; scope: string },
): Promise<RemoveContentResult> {
  const { kind, id, scope } = input;
  const { data, error } = await loadContentRow(db, kind, id);

  if (error) {
    return { ok: false, removed: false, content: null, chatCommunityId: null, error };
  }

  const row = (data ?? null) as unknown as ContentRow | null;
  if (!row) {
    return { ok: true, removed: false, content: null, chatCommunityId: null };
  }

  // The event's group chat outlives its event: its members keep the room and
  // the conversation, and only lose what pointed at the event (see
  // 20260925140000_event_delete_keeps_group_chat). Unlink before the delete so
  // nothing cascades — the room survives even where the old
  // `on delete cascade` constraint is still in place.
  let chatCommunityId: string | null = null;
  if (kind === "event") {
    const { data: roomRow, error: unlinkError } = await db
      .from("communities")
      .update({ event_id: null } as never)
      .eq("event_id", id)
      .select("id")
      .maybeSingle();
    if (unlinkError) {
      console.error("[content-removal] group chat unlink failed:", unlinkError);
    }
    chatCommunityId = (roomRow as { id: string } | null)?.id ?? null;
  }

  const { error: deleteError } = await db.from(CONTENT_TABLES[kind]).delete().eq("id", id);
  if (deleteError) {
    return { ok: false, removed: false, content: null, chatCommunityId, error: deleteError };
  }

  await cleanupContentMedia(db, kind, row);
  announceRemoval(kind, id, scope, chatCommunityId);

  return {
    ok: true,
    removed: true,
    content: {
      kind,
      id,
      userId: row.user_id,
      communityId: row.community_id,
      title: row.title,
    },
    chatCommunityId,
  };
}
