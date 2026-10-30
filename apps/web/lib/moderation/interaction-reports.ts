import "server-only";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import type { ServiceClient } from "@/lib/supabase/service";
import type { NotificationEntityType } from "@/lib/notifications";
import type { InteractionReportType } from "@/lib/communities/report-reasons";

/**
 * Target loading and removal for the interaction report queue.
 *
 * Post-level reports keep their own removal/restore machinery
 * (`lib/communities/content-removal.ts`). Comments, chat messages and profiles
 * have different shapes and different "remove" semantics, so they get a small
 * dedicated path here: a snapshot at report time, and a single delete when a
 * moderator upholds the report. Profiles are never deleted from this queue —
 * the reviewer opens the member page and uses block/delete there.
 */

export interface InteractionTarget {
  authorId: string | null;
  authorName: string;
  excerpt: string | null;
  contextTitle: string | null;
  contextId: string | null;
  communityId: string | null;
  /** The notification entity a reporter thank-you is scoped to. */
  entityType: NotificationEntityType;
  entityId: string;
}

const EXCERPT_MAX = 500;

function excerpt(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text;
}

async function authorName(db: ServiceClient, userId: string | null): Promise<string> {
  if (!userId) return "Deleted member";
  const { data } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  return data?.name?.trim() || "Member";
}

export async function loadInteractionTarget(
  db: ServiceClient,
  targetType: InteractionReportType,
  targetId: string,
): Promise<InteractionTarget | null> {
  switch (targetType) {
    case "thread_comment": {
      const { data: comment } = await db
        .from("thread_comments")
        .select("user_id, body, thread_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!comment) return null;
      const { data: thread } = await db
        .from("community_threads")
        .select("title, community_id")
        .eq("id", comment.thread_id)
        .maybeSingle();
      return {
        authorId: comment.user_id,
        authorName: await authorName(db, comment.user_id),
        excerpt: excerpt(comment.body),
        contextTitle: thread?.title ?? null,
        contextId: comment.thread_id,
        communityId: thread?.community_id ?? null,
        entityType: "thread",
        entityId: comment.thread_id,
      };
    }

    case "showcase_comment": {
      const { data: comment } = await db
        .from("showcase_comments")
        .select("user_id, body, post_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!comment) return null;
      const { data: post } = await db
        .from("community_showcase_posts")
        .select("title, community_id")
        .eq("id", comment.post_id)
        .maybeSingle();
      return {
        authorId: comment.user_id,
        authorName: await authorName(db, comment.user_id),
        excerpt: excerpt(comment.body),
        contextTitle: post?.title ?? null,
        contextId: comment.post_id,
        communityId: post?.community_id ?? null,
        entityType: "showcase",
        entityId: comment.post_id,
      };
    }

    case "resource_comment": {
      const { data: comment } = await db
        .from("resource_comments")
        .select("user_id, body, resource_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!comment) return null;
      const { data: resource } = await db
        .from("community_resources")
        .select("title, community_id")
        .eq("id", comment.resource_id)
        .maybeSingle();
      return {
        authorId: comment.user_id,
        authorName: await authorName(db, comment.user_id),
        excerpt: excerpt(comment.body),
        contextTitle: resource?.title ?? null,
        contextId: comment.resource_id,
        communityId: resource?.community_id ?? null,
        entityType: "resource",
        entityId: comment.resource_id,
      };
    }

    case "event_comment": {
      const { data: comment } = await db
        .from("event_comments")
        .select("user_id, body, event_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!comment) return null;
      const { data: event } = await db
        .from("community_events")
        .select("title, community_id")
        .eq("id", comment.event_id)
        .maybeSingle();
      return {
        authorId: comment.user_id,
        authorName: await authorName(db, comment.user_id),
        excerpt: excerpt(comment.body),
        contextTitle: event?.title ?? null,
        contextId: comment.event_id,
        communityId: event?.community_id ?? null,
        entityType: "event",
        entityId: comment.event_id,
      };
    }

    case "community_message": {
      const { data: message } = await db
        .from("community_messages")
        .select("id, user_id, content, community_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!message) return null;
      const { data: community } = await db
        .from("communities")
        .select("name")
        .eq("id", message.community_id)
        .maybeSingle();
      return {
        authorId: message.user_id,
        authorName: await authorName(db, message.user_id),
        excerpt: excerpt(message.content),
        contextTitle: community?.name ?? null,
        contextId: message.community_id,
        communityId: message.community_id,
        entityType: "message",
        entityId: message.id,
      };
    }

    case "profile": {
      const { data: user } = await db
        .from("users")
        .select("id, name")
        .eq("id", targetId)
        .maybeSingle();
      if (!user) return null;
      return {
        authorId: user.id,
        authorName: user.name?.trim() || "Member",
        excerpt: "Member profile",
        contextTitle: `Profile of ${user.name?.trim() || "member"}`,
        contextId: user.id,
        communityId: null,
        entityType: "profile",
        entityId: user.id,
      };
    }
  }
}

export type InteractionRemovalResult =
  | { ok: true }
  | { ok: false; reason: "not_removable" | "delete_failed" };

/** Uphold a report by deleting the reported comment or chat message. */
export async function removeInteractionContent(
  db: ServiceClient,
  targetType: InteractionReportType,
  targetId: string,
): Promise<InteractionRemovalResult> {
  switch (targetType) {
    case "profile":
      return { ok: false, reason: "not_removable" };

    case "thread_comment":
    case "showcase_comment":
    case "resource_comment": {
      const table =
        targetType === "thread_comment"
          ? "thread_comments"
          : targetType === "showcase_comment"
            ? "showcase_comments"
            : "resource_comments";
      const { error } = await db.from(table).delete().eq("id", targetId);
      return error ? { ok: false, reason: "delete_failed" } : { ok: true };
    }

    case "event_comment": {
      const { data: comment } = await db
        .from("event_comments")
        .select("image_url")
        .eq("id", targetId)
        .maybeSingle();
      const { error } = await db.from("event_comments").delete().eq("id", targetId);
      if (error) return { ok: false, reason: "delete_failed" };
      if (comment?.image_url) {
        try {
          await deleteR2AssetIfUnreferenced(db, comment.image_url, [
            { table: "event_comments", column: "image_url" },
          ]);
        } catch (cleanupError) {
          console.error("[interaction-reports] event comment R2 cleanup:", cleanupError);
        }
      }
      return { ok: true };
    }

    case "community_message": {
      const { data: message } = await db
        .from("community_messages")
        .select("image_url")
        .eq("id", targetId)
        .maybeSingle();
      const { error } = await db.from("community_messages").delete().eq("id", targetId);
      if (error) return { ok: false, reason: "delete_failed" };
      if (message?.image_url) {
        try {
          await deleteR2AssetIfUnreferenced(db, message.image_url, [
            { table: "community_messages", column: "image_url" },
          ]);
        } catch (cleanupError) {
          console.error("[interaction-reports] message R2 cleanup:", cleanupError);
        }
      }
      return { ok: true };
    }
  }
}
