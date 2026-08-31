import "server-only";
import { publishRealtime } from "./publish";

/**
 * Publish a chat-scoped event to the community's realtime room.
 *
 * This replaces the old publishChatFanout which queried all community members
 * and sent N+1 events (1 chat + N panel). Now only ONE event is published
 * to the community chat room. Clients connected to that room receive it
 * directly. Sidebar state is derived client-side from chat events.
 *
 * The database remains the source of truth for unread counts and message
 * history. Users not currently connected catch up on next app open/visibility.
 */
export async function publishChatEvent(params: {
  communityId: string;
  topic: string;
  data: unknown;
  excludeUser?: string;
}): Promise<void> {
  const { realtimeRooms } = await import("./publish");
  await publishRealtime({
    room: realtimeRooms.chat(params.communityId),
    topic: params.topic,
    data: params.data,
    excludeUser: params.excludeUser,
  });
}

/**
 * @deprecated Use publishChatEvent instead. Kept for backward compatibility
 * during migration. Remove after all callers are updated.
 */
export async function publishChatFanout(params: {
  communityId: string;
  memberUserIds: string[];
  chatTopic: string;
  chatData: unknown;
  panelTopic: string;
  panelData?: unknown;
}): Promise<void> {
  const { realtimeRooms } = await import("./publish");
  // New behavior: publish only to the chat room, ignoring panel fan-out.
  await publishRealtime({
    room: realtimeRooms.chat(params.communityId),
    topic: params.chatTopic,
    data: params.chatData,
  });
}

/**
 * @deprecated No longer needed. Members are not queried for realtime fan-out.
 * Community messages are published to the chat room; only connected clients
 * receive them. Sidebar state is derived client-side.
 */
export async function loadCommunityMemberUserIds(
  _db: { from: (table: string) => any },
  _communityId: string,
): Promise<string[]> {
  return [];
}
