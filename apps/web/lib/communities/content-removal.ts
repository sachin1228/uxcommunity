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
 *
 * Admin removals are undoable: `snapshot` captures the row and its discussion
 * (comments, reactions, likes/saves/RSVPs/poll votes) into `content_removals`
 * and KEEPS the R2 objects, so `restoreRemovedContent` can put everything back
 * with the same ids. Media that is never restored is reaped by the R2 orphan
 * audit after its grace period (see lib/r2-cleanup). Member/manager deletions
 * take the fast path: no snapshot, immediate media cleanup.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SHOWCASE_ATTACHMENT_LOOKUP,
  SHOWCASE_POSTER_LOOKUP,
  THREAD_ATTACHMENT_LOOKUP,
  attachmentPosterUrls,
  attachmentUrls,
} from "@uxcommunity/shared";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { contentEventPayload } from "@/lib/communities/content-events";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import type { Json } from "@/lib/supabase/database.types";
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
  /** The `content_removals` row an admin can undo, when one was written. */
  removalId: string | null;
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

/** Discussion tables owned by each content kind, captured for an undo. */
interface ChildSpec {
  table: string;
  column: string;
}

const REMOVAL_CHILDREN: Record<RemovableContentKind, ChildSpec[]> = {
  thread: [
    { table: "thread_comments", column: "thread_id" },
    { table: "thread_likes", column: "thread_id" },
    { table: "thread_saves", column: "thread_id" },
    { table: "thread_poll_votes", column: "thread_id" },
  ],
  showcase: [
    { table: "showcase_comments", column: "post_id" },
    { table: "showcase_likes", column: "post_id" },
    { table: "showcase_saves", column: "post_id" },
  ],
  resource: [
    { table: "resource_comments", column: "resource_id" },
    { table: "resource_saves", column: "resource_id" },
    { table: "resource_bookmarks", column: "resource_id" },
  ],
  event: [
    { table: "event_comments", column: "event_id" },
    { table: "event_likes", column: "event_id" },
    { table: "event_rsvps", column: "event_id" },
    { table: "event_saves", column: "event_id" },
  ],
};

/** Comment reactions are grandchildren: keyed by the comment ids of a kind. */
const COMMENT_REACTION_SPECS: Record<
  RemovableContentKind,
  { table: string; commentTable: string }
> = {
  thread: { table: "thread_comment_reactions", commentTable: "thread_comments" },
  showcase: { table: "showcase_comment_reactions", commentTable: "showcase_comments" },
  resource: { table: "resource_comment_reactions", commentTable: "resource_comments" },
  event: { table: "event_comment_reactions", commentTable: "event_comments" },
};

export interface RemovalSnapshot {
  version: 1;
  content: Record<string, unknown>;
  children: Record<string, Array<Record<string, unknown>>>;
  event_chat_community_id: string | null;
}

/**
 * Untyped hop for the reviewed table list above — child tables are resolved
 * from this module's own hardcoded maps, never from request input.
 */
function dynamicClient(db: Db): SupabaseClient {
  return db as unknown as SupabaseClient;
}

/**
 * The raw content row (untyped: the four tables have different shapes).
 * Shared with the admin report detail API, which renders it as a preview.
 */
export async function loadContentRow(db: Db, kind: RemovableContentKind, id: string) {
  return db.from(CONTENT_TABLES[kind]).select("*").eq("id", id).maybeSingle();
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

/** Capture the row plus everything the cascade is about to delete. */
async function buildSnapshot(
  db: Db,
  kind: RemovableContentKind,
  row: Record<string, unknown>,
  chatCommunityId: string | null,
): Promise<RemovalSnapshot> {
  const dynamic = dynamicClient(db);
  const contentId = row.id as string;
  const children: Record<string, Array<Record<string, unknown>>> = {};

  for (const spec of REMOVAL_CHILDREN[kind]) {
    const { data, error } = await dynamic.from(spec.table).select("*").eq(spec.column, contentId);
    if (error) throw error;
    children[spec.table] = (data ?? []) as Array<Record<string, unknown>>;
  }

  const reactions = COMMENT_REACTION_SPECS[kind];
  const commentRows = children[reactions.commentTable] ?? [];
  const commentIds = commentRows
    .map((comment) => comment.id)
    .filter((id): id is string => typeof id === "string");
  if (commentIds.length) {
    const { data, error } = await dynamic.from(reactions.table).select("*").in("comment_id", commentIds);
    if (error) throw error;
    children[reactions.table] = (data ?? []) as Array<Record<string, unknown>>;
  } else {
    children[reactions.table] = [];
  }

  return {
    version: 1,
    content: row,
    children,
    event_chat_community_id: chatCommunityId,
  };
}

/** Insert snapshot rows, oldest first so comment replies follow their parents. */
async function insertSnapshotRows(
  dynamic: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
) {
  if (!rows.length) return null;
  const ordered = [...rows].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  const CHUNK = 500;
  for (let start = 0; start < ordered.length; start += CHUNK) {
    const { error } = await dynamic.from(table).insert(ordered.slice(start, start + CHUNK));
    if (error) return error;
  }
  return null;
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

export interface RemoveContentInput {
  kind: RemovableContentKind;
  id: string;
  /** The route scope used for realtime rooms (community id or "public"). */
  scope: string;
  /**
   * Admin removals pass the acting admin's id: the row + discussion are
   * snapshotted into `content_removals` for undo and R2 media is kept alive.
   */
  snapshot?: { removedBy: string } | null;
}

/**
 * Removes one content row plus everything that hung off it.
 *
 * Returns `removed: false` (still `ok`) when the row is already gone: callers
 * can then skip a removal notice but still resolve reports pointing at it.
 */
export async function removeCommunityContent(
  db: Db,
  input: RemoveContentInput,
): Promise<RemoveContentResult> {
  const { kind, id, scope, snapshot } = input;
  const { data, error } = await loadContentRow(db, kind, id);

  if (error) {
    return { ok: false, removed: false, content: null, chatCommunityId: null, removalId: null, error };
  }

  const row = (data ?? null) as unknown as Record<string, unknown> | null;
  if (!row) {
    return { ok: true, removed: false, content: null, chatCommunityId: null, removalId: null };
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

  // Snapshot BEFORE the delete: if it fails, abort so a removal that cannot be
  // undone never happens.
  let removalId: string | null = null;
  if (snapshot) {
    try {
      const captured = await buildSnapshot(db, kind, row, chatCommunityId);
      const { data: removalRow, error: snapshotError } = await db
        .from("content_removals")
        .insert({
          content_type: kind,
          content_id: id,
          community_id: (row.community_id as string | null) ?? null,
          content_author_id: (row.user_id as string | null) ?? null,
          content_title: (row.title as string | null) ?? null,
          snapshot: captured as unknown as Json,
          removed_by: snapshot.removedBy,
        })
        .select("id")
        .single();
      if (snapshotError || !removalRow) throw snapshotError ?? new Error("snapshot insert failed");
      removalId = (removalRow as { id: string }).id;
    } catch (snapshotError) {
      console.error("[content-removal] snapshot failed:", snapshotError);
      return {
        ok: false,
        removed: false,
        content: null,
        chatCommunityId,
        removalId: null,
        error: snapshotError,
      };
    }
  }

  const { error: deleteError } = await db.from(CONTENT_TABLES[kind]).delete().eq("id", id);
  if (deleteError) {
    return { ok: false, removed: false, content: null, chatCommunityId, removalId, error: deleteError };
  }

  // A snapshotted removal keeps its media so the undo can restore working
  // URLs; the orphan audit reclaims it if the removal is never undone.
  if (!snapshot) {
    await cleanupContentMedia(db, kind, row as unknown as ContentRow);
  }

  announceRemoval(kind, id, scope, chatCommunityId);

  return {
    ok: true,
    removed: true,
    content: {
      kind,
      id,
      userId: row.user_id as string,
      communityId: (row.community_id as string | null) ?? null,
      title: (row.title as string | null) ?? null,
    },
    chatCommunityId,
    removalId,
  };
}

export interface RestoreContentResult {
  ok: boolean;
  /** False when the removal was already undone. */
  restored: boolean;
  content: RemovedContentInfo | null;
  error?: unknown;
}

/**
 * Puts a snapshotted removal back: the row is re-inserted with its original
 * id, then its discussion, reactions and, for events, the group-chat link.
 * Report rows are re-opened by the caller (it owns the review semantics).
 */
export async function restoreRemovedContent(
  db: Db,
  input: { removalId: string; undoneBy: string },
): Promise<RestoreContentResult> {
  const { data, error } = await db
    .from("content_removals")
    .select("*")
    .eq("id", input.removalId)
    .maybeSingle();

  if (error) {
    return { ok: false, restored: false, content: null, error };
  }

  const removal = (data ?? null) as unknown as {
    id: string;
    content_type: RemovableContentKind;
    content_id: string;
    community_id: string | null;
    snapshot: RemovalSnapshot;
    undone_at: string | null;
  } | null;

  if (!removal) {
    return { ok: false, restored: false, content: null, error: new Error("removal not found") };
  }
  if (removal.undone_at) {
    return { ok: true, restored: false, content: null };
  }

  const kind = removal.content_type;
  const snapshot = removal.snapshot;
  const dynamic = dynamicClient(db);

  // 1. The content row, with its original id.
  const { error: contentError } = await dynamic
    .from(CONTENT_TABLES[kind])
    .insert(snapshot.content as never);
  if (contentError) {
    return { ok: false, restored: false, content: null, error: contentError };
  }

  // 2. Discussion + engagement, oldest rows first so a reply never lands
  //    before its parent; reactions wait until their comments exist.
  for (const spec of REMOVAL_CHILDREN[kind]) {
    const childError = await insertSnapshotRows(dynamic, spec.table, snapshot.children[spec.table] ?? []);
    if (childError) {
      return { ok: false, restored: false, content: null, error: childError };
    }
  }
  const reactions = COMMENT_REACTION_SPECS[kind];
  const reactionError = await insertSnapshotRows(
    dynamic,
    reactions.table,
    snapshot.children[reactions.table] ?? [],
  );
  if (reactionError) {
    return { ok: false, restored: false, content: null, error: reactionError };
  }

  // 3. An event's group chat gets its link back when the room still exists and
  //    is not already bound to another event.
  if (kind === "event" && snapshot.event_chat_community_id) {
    const { data: room } = await db
      .from("communities")
      .select("id, event_id")
      .eq("id", snapshot.event_chat_community_id)
      .maybeSingle();
    if (room && (room as { event_id: string | null }).event_id === null) {
      await db
        .from("communities")
        .update({ event_id: removal.content_id } as never)
        .eq("id", snapshot.event_chat_community_id);
    }
  }

  // 4. Close the removal record.
  const { error: undoError } = await db
    .from("content_removals")
    .update({ undone_at: new Date().toISOString(), undone_by: input.undoneBy })
    .eq("id", removal.id)
    .is("undone_at", null);
  if (undoError) {
    return { ok: false, restored: false, content: null, error: undoError };
  }

  // 5. Put the content back on every timeline. The chat card is the same
  //    "created a …" event the create routes publish.
  const scope = removal.community_id ?? PUBLIC_CONTENT_SCOPE;
  const restoredRow = {
    ...snapshot.content,
    id: removal.content_id,
    community_id: removal.community_id,
  };
  const payload = contentEventPayload(restoredRow, kind);
  const announcements: Array<{ room: string; topic: string; data: unknown }> = [
    { room: realtimeRooms.chat(scope), topic: "content-insert", data: payload },
  ];
  if (kind === "thread") {
    announcements.push({ room: realtimeRooms.threads(scope), topic: "thread", data: restoredRow });
  } else if (kind === "resource") {
    announcements.push({ room: realtimeRooms.resources(scope), topic: "resource", data: restoredRow });
  } else if (kind === "event") {
    announcements.push({ room: realtimeRooms.events(scope), topic: "event", data: restoredRow });
  }
  if (kind === "event" && snapshot.event_chat_community_id) {
    announcements.push({
      room: realtimeRooms.chat(snapshot.event_chat_community_id),
      topic: "content-insert",
      data: payload,
    });
  }
  void publishRealtimeBatch(announcements);

  return {
    ok: true,
    restored: true,
    content: {
      kind,
      id: removal.content_id,
      userId: (snapshot.content.user_id as string) ?? "",
      communityId: removal.community_id,
      title: (snapshot.content.title as string | null) ?? null,
    },
  };
}
