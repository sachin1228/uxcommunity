/**
 * Direct messages REST calls — the same endpoints the web thread uses.
 */

import { apiFetch } from './api';
import type { DmConversation, DmMessage, DmRequestState } from './dm';

export async function getDmConversations(): Promise<DmConversation[]> {
  const { data } = await apiFetch<{ conversations?: DmConversation[] }>(
    '/api/dm/conversations',
  );
  return data?.conversations ?? [];
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
  const { data } = await apiFetch<{ messages?: DmMessage[] }>(
    `/api/dm/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
  const messages = data?.messages ?? [];
  return { messages, hasMore: messages.length >= 50 };
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
  content: string,
  clientNonce: string,
): Promise<DmSendResult> {
  const { data, status } = await apiFetch<{
    message?: DmMessage;
    request_state?: DmRequestState;
    requested_by?: string | null;
    duplicate?: boolean;
  }>(`/api/dm/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content, client_nonce: clientNonce },
  });

  if (!data?.message) {
    const error = new Error('The message could not be sent.') as Error & { status: number };
    error.status = status;
    throw error;
  }

  return {
    message: data.message,
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

/** Conversations with unread peer messages — the topbar envelope badge. */
export async function getDmUnread(): Promise<number> {
  const { data } = await apiFetch<{ count?: number }>('/api/dm/unread');
  return data?.count ?? 0;
}

/** Lift a block the member placed (idempotent). */
export async function unblockUser(userId: string): Promise<void> {
  await apiFetch(`/api/dm/blocks?user_id=${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
