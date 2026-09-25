import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The notification types the app still generates: engagement on the user's own
 * content (comments, replies, likes) plus event RSVPs.
 *
 * The community broadcasts ("started a new thread", "shared a new resource",
 * "created a new event") and the chat @mention rows are gone — no route
 * creates them any more, and the existing rows were cleared by
 * migration 20260915120000_remove_broadcast_and_mention_notifications.sql.
 */
export type NotificationType =
  | "thread_comment"
  | "thread_reply"
  | "thread_like"
  | "resource_comment"
  | "resource_reply"
  | "event_comment"
  | "event_reply"
  | "event_rsvp";

export type NotificationEntityType = "thread" | "resource" | "event";

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
  /** Arbitrary JSON stored on the notification row (see the `metadata` column). */
  metadata?: Json;
}

type DeferredNotificationInput = Omit<NotificationInput, "title"> & {
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

export function threadHref(communityId: string, threadId: string) {
  return `/dashboard/communities/${communityId}/threads/${threadId}`;
}

export function resourceHref(communityId: string, resourceId: string) {
  return `/dashboard/communities/${communityId}/resources/${resourceId}`;
}

export function eventHref(communityId: string, eventId: string) {
  return `/dashboard/communities/${communityId}/events/${eventId}`;
}
