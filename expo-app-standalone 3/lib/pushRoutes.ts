import type { Href } from 'expo-router';
import type { PushData } from './push';

/**
 * Where a tap opens: the community chat, the DM conversation, the notifications
 * list (every activity row), or the event's room / home feed.
 *
 * Kept free of React Native so the mapping can be unit-tested.
 */
export function routeForPush(data: PushData): Href {
  if (data.type === 'community_message') {
    return { pathname: '/community/[id]', params: { id: data.communityId } };
  }
  if (data.type === 'dm_message') {
    return {
      pathname: '/messages/[id]',
      params: {
        id: data.conversationId,
        ...(data.senderName ? { name: data.senderName } : {}),
        ...(data.senderAvatarUrl ? { avatar: data.senderAvatarUrl } : {}),
        ...(data.senderId ? { peerId: data.senderId } : {}),
      },
    };
  }
  if (data.type === 'app_notification') {
    return '/notifications';
  }
  return data.communityId
    ? { pathname: '/community/[id]', params: { id: data.communityId } }
    : '/(tabs)';
}
