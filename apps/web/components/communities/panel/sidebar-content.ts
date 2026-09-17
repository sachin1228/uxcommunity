import type { CachedSidebarCommunity, SidebarLastContent } from "@/lib/communities/cache";

type Content = SidebarLastContent;

export const CONTENT_KIND_NOUN: Record<Content["kind"], string> = {
  thread: "thread",
  showcase: "showcase",
  resource: "resource",
  event: "event",
};

/**
 * The sidebar preview line for a community whose newest activity is a
 * thread/showcase post/resource/event: "john created a thread", or
 * "You created a showcase" for the author's own rows — the same language the
 * chat timeline's notification card uses.
 */
export function formatContentPreview(content: Content): {
  prefix: string;
  text: string;
} {
  const prefix = content.isOwn
    ? "You"
    : (content.firstName ?? null)?.split(" ")[0] || "Someone";
  return { prefix, text: `created a ${CONTENT_KIND_NOUN[content.kind]}` };
}

/**
 * When a content event lands on the sidebar it must show *instead of* the
 * last-message preview only while it is genuinely the newest activity — the
 * way lastReaction already behaves. A message that arrived after the content
 * item wins the preview back; the unread content items still raise the badge.
 */
export function contentIsNewerThanLastMessage(
  content: Content,
  community: Pick<CachedSidebarCommunity, "last_message">,
): boolean {
  const lastMessageAt = community.last_message?.created_at;
  if (!lastMessageAt) return true;
  return content.created_at > lastMessageAt;
}
