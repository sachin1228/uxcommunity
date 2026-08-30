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
  | "event_save";

export type NotificationEntityType = "community" | "thread" | "resource" | "event";

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

export async function notifyCommunityMembers(
  db: ReturnType<typeof createServiceClient>,
  input: CommunityNotificationInput,
) {
  const { data, error } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", input.communityId)
    .neq("user_id", input.actorId);

  if (error) {
    console.error("[notifications] community member lookup failed", error);
    return;
  }

  const rows = (data ?? []).map((member) => ({
    user_id: member.user_id,
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

  const { data: insertedRows, error: insertError } = (await db
    .from("notifications")
    .insert(rows)
    .select("id, user_id, type, title, body, href, read_at, created_at")) as unknown as {
    data: Array<{
      id: string;
      user_id: string;
      type: string;
      title: string;
      body: string | null;
      href: string;
      read_at: string | null;
      created_at: string;
    }> | null;
    error: unknown;
  };
  if (insertError) {
    console.error("[notifications] bulk insert failed", insertError);
  }

  // Best-effort realtime fan-out to each recipient's bell dropdown.
  if (insertedRows?.length) {
    void publishRealtimeBatch(
      insertedRows.map((row) => ({
        room: realtimeRooms.notifications(row.user_id),
        topic: "insert",
        data: row,
      })),
    );
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
