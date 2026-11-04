import { chatCache } from './chatCacheStore';
import { getMessages } from './communities';
import { createCommunityMessageStore } from './communityMessageStore';
import { applyReactionDelete, applyReactionInsert } from './chat';
import type { Message } from './communities';
import { warmChatMedia } from './chatMediaPrefetch';
import { readCommunityPushSnapshot } from './chatPushSnapshot';

async function fetchMessages(communityId: string, after?: Parameters<typeof getMessages>[2]) {
  const rows = await getMessages(communityId, undefined, after);
  void warmChatMedia(rows).catch(() => {});
  return rows;
}

export const communityMessageStore = createCommunityMessageStore({
  load: (userId, communityId) => chatCache.loadCommunityWindow(userId, communityId),
  save: (userId, communityId, window) => chatCache.saveCommunityWindow(userId, communityId, window),
  // Messages-only API: metadata, rules and timeline cards load independently.
  fetchLatest: (communityId) => fetchMessages(communityId),
  fetchAfter: (communityId, cursor) => fetchMessages(communityId, cursor),
});

export function prefetchCommunityMessages(userId: string | null | undefined, communityId: string): void {
  if (userId && communityId) void communityMessageStore.sync(userId, communityId).catch(() => {});
}

export function cacheCommunityPushSnapshot(userId: string, data: Record<string, unknown>): boolean {
  const row = readCommunityPushSnapshot(userId, data);
  if (row) cacheCommunityMessageEvent(userId, `chat:${data.communityId}`, 'message', row);
  return row !== null;
}

/** Called for every community socket, even when its chat screen is closed. */
export function cacheCommunityMessageEvent(userId: string, room: string, topic: string, data: unknown): void {
  if (!room.startsWith('chat:') || !data || typeof data !== 'object') return;
  const communityId = room.slice('chat:'.length);
  const row = data as Record<string, unknown>;
  if (row.community_id && row.community_id !== communityId) return;
  if (topic === 'message') {
    if (typeof row.id !== 'string' || typeof row.user_id !== 'string' || typeof row.created_at !== 'string') return;
    const message: Message = {
      id: row.id, user_id: row.user_id, created_at: row.created_at,
      content: typeof row.content === 'string' ? row.content : null,
      image_url: typeof row.image_url === 'string' ? row.image_url : null,
      reply_to_id: typeof row.reply_to_id === 'string' ? row.reply_to_id : null,
      deleted_at: null, edited_at: null, reactions: [], reply_to: null,
      users: typeof row.sender_name === 'string'
        ? { name: row.sender_name, avatar_url: typeof row.sender_avatar_url === 'string' ? row.sender_avatar_url : null, designation: null }
        : null,
      mentions: Array.isArray(row.mentions) ? row.mentions as Message['mentions'] : [],
      reply_to_content: typeof row.reply_to_content_id === 'string' && typeof row.reply_content_kind === 'string'
        ? { id: row.reply_to_content_id, kind: row.reply_content_kind as NonNullable<Message['reply_to_content']>['kind'], title: typeof row.reply_content_title === 'string' ? row.reply_content_title : '' }
        : null,
    };
    if (message.reply_to_id && typeof row.reply_sender_name === 'string') {
      message.reply_to = { id: message.reply_to_id, content: '', user_name: row.reply_sender_name,
        user_id: typeof row.reply_sender_id === 'string' ? row.reply_sender_id : null };
    }
    communityMessageStore.remember(userId, communityId, [message]);
  } else if (topic === 'message-edit' && typeof row.id === 'string') {
    communityMessageStore.update(userId, communityId, (rows) => rows.map((message) => message.id === row.id
      ? { ...message, content: typeof row.content === 'string' ? row.content : message.content,
          edited_at: typeof row.edited_at === 'string' ? row.edited_at : message.edited_at } : message));
  } else if (topic === 'message-delete' && typeof row.id === 'string' && typeof row.deleted_at === 'string') {
    communityMessageStore.update(userId, communityId, (rows) => rows.map((message) => message.id === row.id
      ? { ...message, content: null, image_url: null, deleted_at: row.deleted_at as string, reply_to: null, reactions: [] } : message));
  } else if (topic === 'messages-expired' && typeof row.cutoff === 'string') {
    const cutoff = Date.parse(row.cutoff);
    if (Number.isFinite(cutoff)) communityMessageStore.update(userId, communityId, (rows) => rows.filter((message) => Date.parse(message.created_at) >= cutoff));
  } else if (['reaction-insert', 'reaction-update', 'reaction-delete'].includes(topic) &&
    typeof row.message_id === 'string' && typeof row.user_id === 'string' && typeof row.emoji === 'string') {
    communityMessageStore.update(userId, communityId, (rows) => rows.map((message) => message.id === row.message_id
      ? { ...message, reactions: (topic === 'reaction-delete' ? applyReactionDelete : applyReactionInsert)(message.reactions, row.emoji as string, row.user_id as string) }
      : message));
  }
}
