/** Leave headroom under the 4096-byte provider limit for APNs/FCM envelopes. */
const MAX_SNAPSHOT_BYTES = 1_800;
const MAX_PAYLOAD_WITH_SNAPSHOT_BYTES = 3_000;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function buildChatPushSnapshot(params: {
  communityId: string; messageId: string; senderId: string; senderName: string | null;
  senderAvatarUrl?: string | null; content: string | null;
  snapshot?: {
    created_at: string; image_url: string | null; reply_to_id: string | null;
    mentions: Array<{ user_id: string; name: string }>;
    reply_to_content_id: string | null; reply_content_kind: string | null; reply_content_title: string | null;
  };
}): string | undefined {
  if (!params.snapshot) return undefined;
  const row = {
    ...params.snapshot, id: params.messageId, community_id: params.communityId,
    user_id: params.senderId, sender_name: params.senderName,
    sender_avatar_url: params.senderAvatarUrl ?? null, content: params.content,
  };
  return bytes(row) <= MAX_SNAPSHOT_BYTES ? JSON.stringify(row) : undefined;
}

export function withChatPushSnapshot<T extends object>(payload: T, snapshot: string | undefined): T & { chatMessage?: string } {
  if (!snapshot) return payload;
  const candidate = { ...payload, chatMessage: snapshot };
  return bytes(candidate) <= MAX_PAYLOAD_WITH_SNAPSHOT_BYTES ? candidate : payload;
}
