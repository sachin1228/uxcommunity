import type { Community, LastContent, LastMessage } from './communities';
import type { ChatContentKind } from './chatContentEvents';

export const CONTENT_KIND_NOUN: Record<ChatContentKind, string> = {
  thread: 'thread',
  showcase: 'showcase',
  resource: 'resource',
  event: 'event',
};

/**
 * The preview line for a community whose newest activity is a thread/showcase
 * post/resource/event: "john created a thread", or "You created a showcase"
 * for the author's own rows — the same language the chat timeline's
 * notification card uses (web `formatContentPreview`).
 */
export function formatContentPreview(content: LastContent): {
  prefix: string;
  text: string;
} {
  const prefix = content.isOwn
    ? 'You'
    : (content.firstName ?? null)?.split(' ')[0] || 'Someone';
  const noun = CONTENT_KIND_NOUN[content.kind];
  return {
    prefix,
    text: /^[aeiou]/i.test(noun) ? `created an ${noun}` : `created a ${noun}`,
  };
}

/**
 * When a content event lands on the row it must show *instead of* the
 * last-message preview only while it is genuinely the newest activity. A
 * message that arrived after the content item wins the preview back; unread
 * content items still raise the badge (web `contentIsNewerThanLastMessage`).
 */
export function contentIsNewerThanLastMessage(
  content: LastContent,
  community: Pick<Community, 'last_message'>,
): boolean {
  const lastMessageAt = community.last_message?.created_at;
  if (!lastMessageAt) return true;
  return content.created_at > lastMessageAt;
}

/**
 * The chat-list preview for a community's last message — mirrors the web
 * sidebar (`apps/web/components/communities/panel/sidebar-content.ts`).
 *
 * A reply to the sender's own message reads like a fresh message for every
 * viewer, not just the author: "john: tomorrow", never "john: replied to
 * john: tomorrow".
 */
export function formatLastMessagePreview(message: LastMessage): {
  prefix?: string;
  text: string;
} {
  const sender = message.is_own
    ? 'You'
    : message.user.name
      ? message.user.name.split(' ')[0]
      : '';

  if (message.is_deleted) return { prefix: sender, text: 'Message deleted' };
  if (message.has_image && !message.content) {
    return { prefix: sender, text: '📷 Photo' };
  }

  const senderFirstName = (message.user.name ?? '').split(' ')[0].toLowerCase();
  const repliedToSelf =
    !!message.reply_to_user &&
    !!senderFirstName &&
    senderFirstName === message.reply_to_user.toLowerCase();

  if (message.is_reply && !repliedToSelf) {
    return {
      prefix: sender,
      text: message.reply_to_user
        ? `replied to ${message.reply_to_user}: ${message.content ?? ''}`
        : `replied: ${message.content ?? ''}`,
    };
  }

  return { prefix: sender, text: message.content ?? '' };
}
