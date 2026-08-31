import "server-only";
import { publishRealtime } from "./publish";

/**
 * Publish a chat-scoped event to the community's realtime room.
 *
 * Only ONE event is published to the community chat room (chat:${communityId}).
 * Clients connected to that room receive it directly. The community DO handles
 * topic filtering so only sockets subscribed to the "chat" topic receive it.
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
