import type { LastMessage } from './communities';

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
