import "server-only";
import { realtimeRooms, publishRealtimeBatch } from "./publish";

/** Load the user ids of everyone who has joined a community. */
export async function loadCommunityMemberUserIds(
  db: { from: (table: string) => any },
  communityId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId);
  if (error) {
    console.error("[realtime] member lookup failed", error);
    return [];
  }
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

/**
 * Fan out a chat-scoped event to the community chat room plus every member's
 * sidebar panel room in a single request. The Worker forwards each event to its
 * room's Durable Object, so this stays one HTTP call regardless of member count.
 *
 * `chatData` and `panelData` may differ because the chat view and the sidebar
 * consume different payload shapes for the same logical event.
 */
export async function publishChatFanout(params: {
  communityId: string;
  memberUserIds: string[];
  chatTopic: string;
  chatData: unknown;
  panelTopic: string;
  panelData?: unknown;
}): Promise<void> {
  const events = [
    {
      room: realtimeRooms.chat(params.communityId),
      topic: params.chatTopic,
      data: params.chatData,
    },
    ...params.memberUserIds.map((userId) => ({
      room: realtimeRooms.panel(userId),
      topic: `${params.panelTopic}:${params.communityId}`,
      data: params.panelData ?? params.chatData,
    })),
  ];
  await publishRealtimeBatch(events);
}