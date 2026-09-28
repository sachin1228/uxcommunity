import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { isPublicContentScope } from "@/lib/content-scope";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { notificationRealtimeEvent } from "@/lib/notifications-realtime";
import { logEvent } from "@/lib/observability/log";
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

  // The database owns the dedupe decision now. `create_notification` inserts a
  // new unread row or atomically aggregates this event into the existing one for
  // (user_id, entity_type, entity_id) in a single statement, backed by the
  // partial unique index from migration 20260928140000_notification_dedupe.sql.
  // Two concurrent callers can no longer both pass an existence check and both
  // insert, so interactions on the same entity still collapse into one unread
  // row (bumping created_at keeps it at the top of the list and metadata.count
  // records how many events it aggregates).
  const { data, error } = await callPerformanceRpc(db, "create_notification", {
    p_user_id: input.userId,
    p_actor_id: input.actorId ?? null,
    p_community_id: communityId,
    p_type: input.type,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_title: title,
    p_body: body,
    p_href: href,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    logEvent("error", {
      event: "notifications.create_failed",
      user_id: input.userId,
      entity_type: input.entityType,
      error,
    });
    return { ok: false, error };
  }

  const created = data?.[0] ?? null;
  if (created) {
    // `inserted` decides insert vs update: a deduplicated event must not emit a
    // second insert, which would double the client's unread badge.
    void publishRealtimeBatch([
      notificationRealtimeEvent(created, realtimeRooms.notifications(input.userId)),
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
      logEvent("error", {
        event: "notifications.deferred_delivery_failed",
        user_id: input.userId,
        entity_type: input.entityType,
        error,
      });
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
