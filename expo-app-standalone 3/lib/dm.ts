/**
 * Direct messages — the platform-free half: payload types, the conversation
 * preview rules, the request lifecycle copy and the composer states (ports of
 * the web list pane and thread footer rules).
 *
 * Nothing here imports React Native or the API client, so the rules run under
 * `tsx --test` (see dm.test.ts). The REST calls live in dmApi.ts.
 */

export type DmRequestState = 'pending' | 'accepted' | 'rejected';

export interface DmPeer {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface DmLastMessage {
  id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  user_id: string;
  deleted_at: string | null;
  edited_at: string | null;
}

/**
 * The newest reaction event on a conversation, as its list row previews it —
 * the camelCase shape the web server projects (`toLastReaction`).
 */
export interface DmLastReaction {
  messageId: string;
  reactorId: string;
  emoji: string;
  createdAt: string;
  firstName: string;
  isOwn: boolean;
  messagePreview: string;
  messagePreviewMedia: 'image' | null;
}

/** One row of `GET /api/dm/conversations`. */
export interface DmConversation {
  id: string;
  peer: DmPeer;
  last_message: DmLastMessage | null;
  unread_count: number;
  my_last_read_at: string | null;
  last_message_at: string | null;
  last_reaction?: DmLastReaction | null;
  request_state: DmRequestState;
  requested_by: string | null;
  blocked_by_me: boolean;
}

export interface DmReplyPreview {
  id: string;
  content: string | null;
  user_name: string;
  user_id?: string | null;
}

export interface DmReaction {
  emoji: string;
  user_ids: string[];
}

/** One message from `GET /api/dm/conversations/[id]/messages` (oldest first). */
export interface DmMessage {
  id: string;
  content: string | null;
  created_at: string;
  user_id: string;
  reply_to_id: string | null;
  image_url: string | null;
  deleted_at: string | null;
  edited_at?: string | null;
  users: { name: string; avatar_url: string | null; designation: string | null } | null;
  reactions: DmReaction[];
  reply_to: DmReplyPreview | null;
  /** Client-only — optimistic bubbles carry their send state like the chat's. */
  status?: 'sending' | 'sent' | 'failed';
}

/** Matches the server's DM_MESSAGE_PAGE_SIZE. */
export const DM_MESSAGE_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Request lifecycle
// ---------------------------------------------------------------------------

/** True when the peer sent the request and the viewer can answer it. */
export function isIncomingRequest(
  conversation: Pick<DmConversation, 'request_state' | 'requested_by'>,
  viewerId: string,
): boolean {
  return (
    conversation.request_state === 'pending' &&
    conversation.requested_by !== null &&
    conversation.requested_by !== viewerId
  );
}

/** True when the viewer sent the request and is waiting on the peer. */
export function isOutgoingRequest(
  conversation: Pick<DmConversation, 'request_state' | 'requested_by'>,
  viewerId: string,
): boolean {
  return conversation.request_state === 'pending' && conversation.requested_by === viewerId;
}

/**
 * True before anyone has sent the first message: the next send becomes the
 * request, so the composer carries the one-message hint.
 */
export function isUnstartedRequest(
  conversation: Pick<DmConversation, 'request_state' | 'requested_by'>,
): boolean {
  return conversation.request_state === 'pending' && conversation.requested_by === null;
}

/** The composer state the thread footer renders, in web precedence order. */
export type DmComposerState =
  | { kind: 'blocked' }
  | { kind: 'incoming-request' }
  | { kind: 'outgoing-request' }
  | { kind: 'rejected' }
  | { kind: 'ready' };

export function dmComposerState(
  conversation: Pick<DmConversation, 'request_state' | 'requested_by' | 'blocked_by_me'>,
  viewerId: string,
): DmComposerState {
  if (conversation.blocked_by_me) return { kind: 'blocked' };
  if (isIncomingRequest(conversation, viewerId)) return { kind: 'incoming-request' };
  if (isOutgoingRequest(conversation, viewerId)) return { kind: 'outgoing-request' };
  if (conversation.request_state === 'rejected') return { kind: 'rejected' };
  return { kind: 'ready' };
}

/**
 * The pre-send hint while a request is not answered yet. Before the first
 * message lands, `requested_by` is still null, so "who is the requester"
 * cannot be known yet — the copy stays neutral in that window.
 */
export function requestHintForPeer(peerName: string): string {
  return `You can send one message until ${peerName} accepts your request — then you can chat regularly.`;
}

// ---------------------------------------------------------------------------
// List-row presentation
// ---------------------------------------------------------------------------

/**
 * The list row's one-line preview, in the web pane's precedence: a pending
 * incoming request shows "Message request" instead of the message text; a
 * reaction preview outranks it only for accepted conversations (the web rule:
 * typing > request > reaction > message). Typing is client-local and handled
 * by the screen, not here.
 */
export function dmConversationPreview(
  conversation: DmConversation,
  viewerId: string,
): { text: string; muted: boolean } {
  if (isIncomingRequest(conversation, viewerId)) {
    return { text: 'Message request', muted: true };
  }

  if (conversation.last_reaction && conversation.last_message) {
    return {
      text: `${conversation.last_reaction.firstName} reacted ${conversation.last_reaction.emoji} to: ${conversation.last_reaction.messagePreview}`,
      muted: true,
    };
  }

  const message = conversation.last_message;
  if (!message) return { text: 'Say hi — no messages yet', muted: true };

  const ownPrefix = message.user_id === viewerId ? 'You: ' : '';
  if (message.deleted_at) {
    return { text: `${ownPrefix}This message was deleted`, muted: true };
  }
  if (message.image_url && !message.content) {
    return { text: `${ownPrefix}Photo`, muted: true };
  }
  return {
    text: `${ownPrefix}${message.content?.trim() ?? ''}`,
    muted: !message.content?.trim(),
  };
}

/** Blue unread pill: people-count, cap 99+. */
export function unreadPillLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** "2h" / "3d" / "12 Oct" — the list row's stamp (web timeAgo-style buckets). */
export function dmTimestampLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const diff = now - at;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Client nonce for send idempotency — the server only needs UUID shape. */
export function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** The unread watermark a thread marks on open: the newest displayed message. */
export function newestMessageAt(messages: readonly DmMessage[]): string | null {
  let newest: string | null = null;
  let newestMs = -Infinity;
  for (const message of messages) {
    const at = Date.parse(message.created_at);
    if (at > newestMs) {
      newestMs = at;
      newest = message.created_at;
    }
  }
  return newest;
}
