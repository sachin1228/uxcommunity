import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";

export type NotificationType =
  | "community_thread"
  | "community_resource"
  | "community_event"
  | "thread_comment"
  | "thread_reply"
  | "thread_like"
  | "resource_comment"
  | "resource_reply"
  | "event_comment"
  | "event_reply"
  | "event_rsvp"
  | "event_save"
  | "chat_mention";

export type NotificationEntityType =
  | "community"
  | "thread"
  | "resource"
  | "event"
  | "message";

interface NotificationInput {
  userId: string;
  actorId?: string | null;
  communityId?: string | null;
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  title: string;
  body?: string | null;
  href: string;
  metadata?: Record<string, unknown>;
}

interface CommunityNotificationInput {
  communityId: string;
  actorId: string;
  type: Extract<NotificationType, "community_thread" | "community_resource" | "community_event">;
  entityType: Extract<NotificationEntityType, "thread" | "resource" | "event">;
  entityId: string;
  title: string;
  body?: string | null;
  href: string;
  metadata?: Record<string, unknown>;
}

type DeferredNotificationInput = Omit<NotificationInput, "title"> & {
  title: (actorName: string) => string;
};

type DeferredCommunityNotificationInput = Omit<CommunityNotificationInput, "title"> & {
  title: (actorName: string) => string;
};

export type NotificationResult =
  | { ok: true; skipped?: "self" }
  | { ok: false; error: unknown };

export async function createNotification(
  db: ReturnType<typeof createServiceClient>,
  input: NotificationInput,
): Promise<NotificationResult> {
  if (input.userId === input.actorId) return { ok: true, skipped: "self" };

  const communityId =
    input.communityId && !isPublicContentScope(input.communityId)
      ? input.communityId
      : null;

  const title = input.title.slice(0, 160);
  const body = input.body?.slice(0, 500) ?? null;
  const href = input.href;

  // Cap storage growth (500MB free tier): interactions on the same entity
  // (e.g. "Sachin replied" then "Priya replied" to the same thread) reuse a
  // single unread notification row instead of creating a new row per event.
  // Bumping created_at keeps the notification at the top of the list, and
  // metadata.count records how many events it aggregates.
  const { data: existing, error: lookupError } = (await db
    .from("notifications")
    .select("id, metadata")
    .eq("user_id", input.userId)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as {
    data: { id: string; metadata: Record<string, unknown> | null } | null;
    error: unknown;
  };

  if (!lookupError && existing) {
    const prevMetadata = existing.metadata ?? {};
    const prevCount =
      typeof prevMetadata.count === "number" ? prevMetadata.count : 1;
    const createdNow = new Date().toISOString();
    const { error } = (await db
      .from("notifications")
      .update({
        actor_id: input.actorId ?? null,
        type: input.type,
        title,
        body,
        href,
        metadata: { ...prevMetadata, count: prevCount + 1 },
        created_at: createdNow,
      } as never)
      .eq("id", existing.id)) as unknown as { error: unknown };
    if (error) {
      console.error("[notifications] dedupe update failed", error);
      return { ok: false, error };
    }
    // Best-effort realtime: keep other open bell dropdowns in sync.
    void publishRealtimeBatch([
      {
        room: realtimeRooms.notifications(input.userId),
        topic: "update",
        data: {
          next: {
            id: existing.id,
            user_id: input.userId,
            actor_id: input.actorId ?? null,
            community_id: input.communityId ?? null,
            type: input.type,
            entity_type: input.entityType,
            entity_id: input.entityId,
            title,
            body,
            href,
            read_at: null,
            created_at: createdNow,
          },
          old: { id: existing.id, read_at: null },
        },
      },
    ]);
    return { ok: true };
  }

  const { data: insertedRow, error } = (await db
    .from("notifications")
    .insert({
      user_id: input.userId,
      actor_id: input.actorId ?? null,
      community_id: communityId,
      type: input.type,
      entity_type: input.entityType,
      entity_id: input.entityId,
      title,
      body,
      href,
      metadata: input.metadata ?? {},
    })
    .select("id, user_id, type, title, body, href, read_at, created_at")
    .single()) as unknown as {
    data: {
      id: string;
      user_id: string;
      type: string;
      title: string;
      body: string | null;
      href: string;
      read_at: string | null;
      created_at: string;
    } | null;
    error: unknown;
  };

  if (error) {
    console.error("[notifications] insert failed", error);
    return { ok: false, error };
  }

  if (insertedRow) {
    void publishRealtimeBatch([
      {
        room: realtimeRooms.notifications(input.userId),
        topic: "insert",
        data: insertedRow,
      },
    ]);
  }

  return { ok: true };
}

/**
 * PostgREST returns at most 1000 rows per request unless the range is paged,
 * and it does so SILENTLY — no error, just a short page. An unpaged member read
 * therefore stops notifying anyone past the 1,000th member of a community.
 */
const MEMBER_PAGE_SIZE = 1000;
/** Rows per insert request — one giant insert fails wholesale on payload limits. */
const NOTIFICATION_INSERT_CHUNK = 500;
/** Recipients per /publish request, so a large fan-out isn't one huge body. */
const NOTIFICATION_PUBLISH_CHUNK = 200;
/** Hard stop so a pathological member table cannot loop forever. */
const MAX_COMMUNITY_MEMBERS = 50_000;

/**
 * Read every member of a community, paging until the end.
 *
 * @returns the user ids, or null when the read failed (caller must not treat a
 * failure as "nobody to notify", which would silently drop the whole fan-out).
 */
async function fetchCommunityMemberIds(
  db: ReturnType<typeof createServiceClient>,
  communityId: string,
  actorId: string,
): Promise<string[] | null> {
  const ids: string[] = [];

  for (let from = 0; from < MAX_COMMUNITY_MEMBERS; from += MEMBER_PAGE_SIZE) {
    const { data, error } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId)
      .neq("user_id", actorId)
      // Stable order is required for range pagination to be correct.
      .order("user_id", { ascending: true })
      .range(from, from + MEMBER_PAGE_SIZE - 1);

    if (error) {
      console.error("[notifications] community member lookup failed", error);
      return null;
    }

    const page = (data ?? []) as Array<{ user_id: string }>;
    for (const member of page) ids.push(member.user_id);
    if (page.length < MEMBER_PAGE_SIZE) return ids;
  }

  console.warn(
    `[notifications] community ${communityId} exceeded ${MAX_COMMUNITY_MEMBERS} members — fan-out truncated`,
  );
  return ids;
}

export async function notifyCommunityMembers(
  db: ReturnType<typeof createServiceClient>,
  input: CommunityNotificationInput,
) {
  const memberIds = await fetchCommunityMemberIds(db, input.communityId, input.actorId);
  if (!memberIds) return; // read failed — logged above

  const rows = memberIds.map((userId) => ({
    user_id: userId,
    actor_id: input.actorId,
    community_id: input.communityId,
    type: input.type,
    entity_type: input.entityType,
    entity_id: input.entityId,
    title: input.title.slice(0, 160),
    body: input.body?.slice(0, 500) ?? null,
    href: input.href,
    metadata: input.metadata ?? {},
  }));

  if (!rows.length) return;

  type InsertedRow = {
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string | null;
    href: string;
    read_at: string | null;
    created_at: string;
  };

  // Chunked so one oversized request cannot lose the whole batch: a failure
  // now costs at most NOTIFICATION_INSERT_CHUNK recipients instead of all.
  const insertedRows: InsertedRow[] = [];
  for (let i = 0; i < rows.length; i += NOTIFICATION_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + NOTIFICATION_INSERT_CHUNK);
    const { data, error } = (await db
      .from("notifications")
      .insert(chunk)
      .select("id, user_id, type, title, body, href, read_at, created_at")) as unknown as {
      data: InsertedRow[] | null;
      error: unknown;
    };
    if (error) {
      console.error("[notifications] bulk insert failed", error);
      continue;
    }
    if (data?.length) insertedRows.push(...data);
  }

  // Best-effort realtime fan-out to each recipient's bell dropdown.
  //
  // One event per recipient is required by the current socket topology: every
  // user's client is subscribed to `notifications:${userId}` on their own
  // UserDO instance, and there is no room all community members share. The
  // fan-out is chunked so a big community is not a single huge request, and
  // sent sequentially to stay well inside Worker subrequest limits.
  if (insertedRows.length) {
    for (let i = 0; i < insertedRows.length; i += NOTIFICATION_PUBLISH_CHUNK) {
      const chunk = insertedRows.slice(i, i + NOTIFICATION_PUBLISH_CHUNK);
      await publishRealtimeBatch(
        chunk.map((row) => ({
          room: realtimeRooms.notifications(row.user_id),
          topic: "insert",
          data: row,
        })),
      );
    }
  }
}

export async function getActorName(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
) {
  const { data } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  return data?.name ?? "Someone";
}

export function deferNotification(input: DeferredNotificationInput) {
  after(async () => {
    try {
      const db = createServiceClient();
      const actorName = input.actorId
        ? await getActorName(db, input.actorId)
        : "Someone";
      await createNotification(db, { ...input, title: input.title(actorName) });
    } catch (error) {
      console.error("[notifications] deferred delivery failed", error);
    }
  });
}

export function deferCommunityNotification(input: DeferredCommunityNotificationInput) {
  after(async () => {
    try {
      const db = createServiceClient();
      const actorName = await getActorName(db, input.actorId);
      await notifyCommunityMembers(db, { ...input, title: input.title(actorName) });
    } catch (error) {
      console.error("[notifications] deferred community delivery failed", error);
    }
  });
}

export function threadHref(communityId: string, threadId: string) {
  return `/dashboard/communities/${communityId}/threads/${threadId}`;
}

export function resourceHref(communityId: string, resourceId: string) {
  return `/dashboard/communities/${communityId}/resources/${resourceId}`;
}

export function eventHref(communityId: string, eventId: string) {
  return `/dashboard/communities/${communityId}/events/${eventId}`;
}
