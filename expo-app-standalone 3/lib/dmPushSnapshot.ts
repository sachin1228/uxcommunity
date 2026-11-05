/**
 * Reads the complete DM row a push carries beside its preview.
 *
 * Mirrors the community chat's push snapshot: a tapped notification renders
 * the message before any API round trip, and the thread's page fetch then
 * reconciles it. The snapshot is accepted only when it belongs to this
 * recipient, this conversation and this notification — a stale or misfiled
 * payload must never seed another chat.
 */

import type { DmMessage } from './dm';

const MAX_SNAPSHOT_CHARS = 2_000;

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function readDmPushSnapshot(
  userId: string,
  data: Record<string, unknown>,
): DmMessage | null {
  if (data.type !== 'dm_message') return null;
  if (data.recipientId !== userId) return null;
  if (typeof data.conversationId !== 'string' || typeof data.dmMessage !== 'string') return null;
  if (data.dmMessage.length > MAX_SNAPSHOT_CHARS) return null;

  let row: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data.dmMessage);
    if (!parsed || typeof parsed !== 'object') return null;
    row = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (typeof row.id !== 'string' || typeof row.user_id !== 'string' || typeof row.created_at !== 'string') {
    return null;
  }
  if (!Number.isFinite(Date.parse(row.created_at))) return null;
  if (row.conversation_id !== data.conversationId) return null;
  if (typeof data.messageId === 'string' && data.messageId !== row.id) return null;
  if (typeof data.senderId === 'string' && data.senderId !== row.user_id) return null;

  const content = optionalString(row.content);
  const imageUrl = optionalString(row.image_url);
  const replyToId = optionalString(row.reply_to_id);
  const senderName = optionalString(row.sender_name);
  const senderAvatarUrl = optionalString(row.sender_avatar_url);
  const replySenderName = optionalString(row.reply_sender_name);
  const replySenderId = optionalString(row.reply_sender_id);
  if (
    content === undefined ||
    imageUrl === undefined ||
    replyToId === undefined ||
    senderName === undefined ||
    senderAvatarUrl === undefined ||
    replySenderName === undefined ||
    replySenderId === undefined
  ) {
    return null;
  }

  return {
    id: row.id,
    content,
    created_at: row.created_at,
    user_id: row.user_id,
    reply_to_id: replyToId,
    image_url: imageUrl,
    deleted_at: null,
    edited_at: null,
    users: senderName
      ? { name: senderName, avatar_url: senderAvatarUrl, designation: null }
      : null,
    reactions: [],
    reply_to: replyToId
      ? {
          id: replyToId,
          content: null,
          user_name: replySenderName ?? '',
          user_id: replySenderId ?? null,
        }
      : null,
    status: 'sent',
  };
}
