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
  const noun = CONTENT_KIND_NOUN[content.kind];
  return { prefix, text: /^[aeiou]/i.test(noun) ? `created an ${noun}` : `created a ${noun}` };
}

/**
 * The sidebar preview line for the community's last message: "john: hi",
 * "You: 📷 Photo", and the reply variants. A reply anchored to a
 * thread/showcase/resource/event card carries no `reply_to_user` (nobody's
 * message was answered) — it names the kind instead, mirroring the chat's
 * reply chip: "You replied to a thread: …".
 */
export function formatMessagePreview(
  msg: NonNullable<CachedSidebarCommunity["last_message"]>,
): {
  prefix?: string;
  text: string;
} {
  const sender = msg.is_own
    ? "You"
    : msg.user?.name
      ? msg.user.name.split(" ")[0]
      : "Someone";
  if (msg.is_deleted) return { prefix: sender, text: "Message deleted" };
  if (msg.has_image && !msg.content) return { prefix: sender, text: "📷 Photo" };
  if (msg.is_reply) {
    const to = msg.reply_to_user ?? null;
    if (!to && msg.reply_to_content_kind) {
      const kind = msg.reply_to_content_kind;
      const article = /^[aeiou]/i.test(kind) ? "an" : "a";
      return { prefix: sender, text: `replied to ${article} ${kind}: ${msg.content}` };
    }
    return {
      prefix: sender,
      text: to ? `replied to ${to}: ${msg.content}` : `replied: ${msg.content}`,
    };
  }
  return { prefix: sender, text: msg.content ?? "" };
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
