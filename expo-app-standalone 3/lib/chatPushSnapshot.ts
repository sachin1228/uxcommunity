/** Complete, size-bounded server rows carried alongside notification previews. */
export interface CommunityNotificationHint {
  userId: string;
  communityId: string;
  chatMessage?: string;
}

export function readCommunityPushSnapshot(userId: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const recipient = data.recipientId ?? data.userId;
  if (recipient !== userId || typeof data.communityId !== 'string' || typeof data.chatMessage !== 'string') return null;
  if (data.chatMessage.length > 2_000) return null;
  try {
    const row: unknown = JSON.parse(data.chatMessage);
    if (!row || typeof row !== 'object') return null;
    const message = row as Record<string, unknown>;
    if (typeof message.id !== 'string' || typeof message.user_id !== 'string' ||
      typeof message.created_at !== 'string' || !Number.isFinite(Date.parse(message.created_at)) ||
      message.community_id !== data.communityId ||
      (message.content !== null && typeof message.content !== 'string') ||
      (message.image_url !== null && typeof message.image_url !== 'string') ||
      (typeof data.messageId === 'string' && data.messageId !== message.id)) return null;
    return message;
  } catch { return null; }
}
