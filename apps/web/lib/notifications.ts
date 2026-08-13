import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isPublicContentScope, publicContentHref } from "@/lib/content-scope";

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
  const { error } = await db.from("notifications").insert({
    user_id: input.userId,
    actor_id: input.actorId ?? null,
    community_id: communityId,
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
    return { ok: false, error };
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
  return isPublicContentScope(communityId)
    ? publicContentHref("thread", threadId)
    : `/dashboard/communities/${communityId}/threads/${threadId}`;
}

export function resourceHref(communityId: string, resourceId: string) {
  return isPublicContentScope(communityId)
    ? publicContentHref("resource", resourceId)
    : `/dashboard/communities/${communityId}/resources/${resourceId}`;
}

export function eventHref(communityId: string, eventId: string) {
  return isPublicContentScope(communityId)
    ? publicContentHref("event", eventId)
    : `/dashboard/communities/${communityId}/events/${eventId}`;
}
