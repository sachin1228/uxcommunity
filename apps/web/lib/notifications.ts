import { createServiceClient } from "@/lib/supabase/service";

export type NotificationType =
  | "community_thread"
  | "community_resource"
  | "community_event"
  | "thread_comment"
  | "thread_reply"
  | "thread_vote"
  | "thread_save"
  | "resource_comment"
  | "resource_reply"
  | "resource_save"
  | "resource_bookmark"
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

export async function createNotification(
  db: ReturnType<typeof createServiceClient>,
  input: NotificationInput,
) {
  if (input.userId === input.actorId) return;

  const { error } = await db.from("notifications").insert({
    user_id: input.userId,
    actor_id: input.actorId ?? null,
    community_id: input.communityId ?? null,
    type: input.type,
    entity_type: input.entityType,
    entity_id: input.entityId,
    title: input.title.slice(0, 160),
    body: input.body?.slice(0, 500) ?? null,
    href: input.href,
    metadata: input.metadata ?? {},
  });

  if (error) {
    console.error("[notifications] insert failed", error);
  }
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

  const { error: insertError } = await db.from("notifications").insert(rows);
  if (insertError) {
    console.error("[notifications] bulk insert failed", insertError);
  }
}

export async function getActorName(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
) {
  const { data } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  return data?.name ?? "Someone";
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
