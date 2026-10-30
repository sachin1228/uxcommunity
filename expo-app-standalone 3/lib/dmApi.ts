/**
 * Direct messages REST calls — the same endpoints the web thread uses.
 */

import { apiFetch, apiFormUpload } from './api';
import type { DmConversation, DmMessage, DmRequestState, DmReaction } from './dm';
import { DM_MESSAGE_PAGE_SIZE } from './dm';

/** The server's message rows omit `designation` — the chat bubble expects it. */
type RawDmMessage = Omit<DmMessage, 'users'> & {
  users?: { name: string; avatar_url: string | null; designation?: string | null } | null;
};

function normalizeMessage(raw: RawDmMessage): DmMessage {
  return {
    ...raw,
    users: raw.users
      ? {
          name: raw.users.name,
          avatar_url: raw.users.avatar_url,
          designation: raw.users.designation ?? null,
        }
      : null,
  };
}

export async function getDmConversations(): Promise<DmConversation[]> {
  const { data } = await apiFetch<{ conversations?: DmConversation[] }>(
    '/api/dm/conversations',
  );
  return data?.conversations ?? [];
}

/**
 * Create-or-get the 1:1 conversation with a member — what the profile's
 * Message chip does on the web (`?peer=` resolves server-side). A brand new
 * conversation comes back with no messages, which is what the thread's empty
 * state renders.
 */
export async function createDmConversation(peerUserId: string): Promise<DmConversation> {
  const { data } = await apiFetch<{ conversation?: DmConversation }>(
    '/api/dm/conversations',
    { method: 'POST', body: { peer_user_id: peerUserId } },
  );
  if (!data?.conversation) {
    throw new Error('The conversation could not be opened.');
  }
  return { ...data.conversation, last_reaction: data.conversation.last_reaction ?? null };
}

export interface DmMessagePage {
  /** Oldest-first, like the server orders the page. */
  messages: DmMessage[];
  hasMore: boolean;
}

/** One page of a thread. Pass the oldest loaded message to read the page before it. */
export async function getDmMessages(
  conversationId: string,
  before?: { createdAt: string; id: string },
): Promise<DmMessagePage> {
  const params = new URLSearchParams();
  if (before) {
    params.set('before', before.createdAt);
    params.set('before_id', before.id);
  }
  const query = params.toString();
  const { data } = await apiFetch<{ messages?: RawDmMessage[] }>(
    `/api/dm/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
  const messages = (data?.messages ?? []).map(normalizeMessage);
  return { messages, hasMore: messages.length >= DM_MESSAGE_PAGE_SIZE };
}

/** Messages strictly newer than the cursor — the reconnect/foreground catch-up. */
export async function getDmMessagesAfter(
  conversationId: string,
  after: { createdAt: string; id: string },
): Promise<DmMessage[]> {
  const params = new URLSearchParams({
    after: after.createdAt,
    after_id: after.id,
  });
  const { data } = await apiFetch<{ messages?: RawDmMessage[] }>(
    `/api/dm/conversations/${conversationId}/messages?${params.toString()}`,
  );
  return (data?.messages ?? []).map(normalizeMessage);
}

export interface DmSendInput {
  content: string;
  imageUrl?: string | null;
  replyToId?: string | null;
}

export interface DmSendResult {
  message: DmMessage;
  requestState: DmRequestState;
  requestedBy: string | null;
  /** True when the server matched an earlier send with the same nonce. */
  duplicate: boolean;
}

/**
 * Send one message. The client nonce makes retries safe: a retried send comes
 * back as `duplicate:true` with the original row instead of inserting twice.
 */
export async function sendDmMessage(
  conversationId: string,
  input: DmSendInput,
  clientNonce: string,
): Promise<DmSendResult> {
  const { data, status } = await apiFetch<{
    message?: RawDmMessage;
    request_state?: DmRequestState;
    requested_by?: string | null;
    duplicate?: boolean;
  }>(`/api/dm/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: {
      content: input.content,
      image_url: input.imageUrl ?? null,
      reply_to_id: input.replyToId ?? null,
      client_nonce: clientNonce,
    },
  });

  if (!data?.message) {
    const error = new Error('The message could not be sent.') as Error & { status: number };
    error.status = status;
    throw error;
  }

  return {
    message: normalizeMessage(data.message),
    requestState: data.request_state ?? 'accepted',
    requestedBy: data.requested_by ?? null,
    duplicate: Boolean(data.duplicate),
  };
}

/** Accept or reject the incoming message request. Idempotent server-side. */
export async function answerDmRequest(
  conversationId: string,
  action: 'accept' | 'reject',
): Promise<void> {
  await apiFetch(`/api/dm/conversations/${conversationId}/request`, {
    method: 'POST',
    body: { action },
  });
}

/** Store the read marker as the newest displayed message's timestamp. */
export async function markDmRead(conversationId: string, lastReadAt: string): Promise<void> {
  await apiFetch(`/api/dm/conversations/${conversationId}/read`, {
    method: 'PATCH',
    body: { last_read_at: lastReadAt },
  });
}

/** Conversations with unread peer messages — the header bubble badge. */
export async function getDmUnread(): Promise<number> {
  const { data } = await apiFetch<{ count?: number }>('/api/dm/unread');
  return data?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Message actions
// ---------------------------------------------------------------------------

/** Edit an owned text message (15-minute window, enforced by the server). */
export async function editDmMessage(
  messageId: string,
  content: string,
): Promise<{ content: string; edited_at: string | null }> {
  const { data } = await apiFetch<{ content?: string; edited_at?: string | null }>(
    `/api/dm/messages/${messageId}`,
    { method: 'PATCH', body: { content } },
  );
  return {
    content: data.content ?? content,
    edited_at: data.edited_at ?? new Date().toISOString(),
  };
}

/** Soft-delete an owned message for both participants. */
export async function deleteDmMessage(messageId: string): Promise<void> {
  await apiFetch(`/api/dm/messages/${messageId}`, { method: 'DELETE' });
}

/**
 * One reaction per member per message. The API takes the explicit desired
 * emoji (null clears it) and returns the authoritative grouped reactions.
 */
export async function setDmMessageReaction(
  messageId: string,
  desiredEmoji: string | null,
): Promise<{ reactions: DmReaction[]; currentUserEmoji: string | null }> {
  const { data } = await apiFetch<{
    reactions?: DmReaction[];
    currentUserEmoji?: string | null;
  }>(`/api/dm/messages/${messageId}/reactions`, {
    method: 'POST',
    body: { desiredEmoji },
  });
  return {
    reactions: data.reactions ?? [],
    currentUserEmoji: data.currentUserEmoji ?? desiredEmoji,
  };
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

/** Relay one typing pulse; a lost pulse is invisible (the next keystroke sends another). */
export async function sendDmTyping(conversationId: string, typing: boolean): Promise<void> {
  await apiFetch(`/api/dm/conversations/${conversationId}/typing`, {
    method: 'POST',
    body: { typing },
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Upload a prepared image into the conversation's DM namespace. */
export async function uploadDmImage(
  conversationId: string,
  image: { uri: string; mimeType: string; name: string },
  signal?: AbortSignal,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: image.uri,
    type: image.mimeType,
    name: image.name,
  } as unknown as Blob);

  const { data } = await apiFormUpload<{ url?: string; error?: string }>(
    `/api/dm/conversations/${conversationId}/upload`,
    formData,
    signal,
  );
  if (!data.url) {
    throw new Error(data.error ?? 'Image could not be uploaded. Please try a different image.');
  }
  return data.url;
}

/** Release an upload whose send was abandoned (no message row references it). */
export async function deleteDmUpload(conversationId: string, url: string): Promise<void> {
  await apiFetch(`/api/dm/conversations/${conversationId}/upload`, {
    method: 'DELETE',
    body: { url },
  });
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

/** Block a member — idempotent; the DB trigger refuses both sides' new sends. */
export async function blockUser(userId: string): Promise<void> {
  await apiFetch('/api/dm/blocks', { method: 'POST', body: { user_id: userId } });
}

/** Lift a block the member placed (idempotent). */
export async function unblockUser(userId: string): Promise<void> {
  await apiFetch(`/api/dm/blocks?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export interface BlockedMember {
  id: string;
  name: string;
  avatar_url: string | null;
  blocked_at: string;
}

/** Everyone the member has blocked, newest first. */
export async function getBlockedUsers(): Promise<BlockedMember[]> {
  const { data } = await apiFetch<{ blocked?: BlockedMember[] }>('/api/dm/blocks');
  return data.blocked ?? [];
}

/** Report the member on the other side of a conversation (admin queue). */
export async function reportDmConversation(
  conversationId: string,
  reason: string,
  details: string,
): Promise<void> {
  await apiFetch('/api/dm/reports', {
    method: 'POST',
    body: { conversation_id: conversationId, reason, details: details.trim() },
  });
}
