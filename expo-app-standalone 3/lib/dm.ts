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

/**
 * The route id a profile uses before the server has issued the conversation's
 * real id. The thread creates the conversation and adopts the id when it
 * answers, so a Message tap never waits on the API to open.
 */
export const PENDING_DM_CONVERSATION_ID = 'new';

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

/**
 * The list row's newest message, shaped for the thread. Opening a chat can
 * therefore paint the message the row already shows before the page request
 * answers — the same instant-open the community chat gets from its push
 * snapshot. The page then replaces this row with the full one.
 */
export function previewToDmMessage(
  last: DmLastMessage,
  peer: DmPeer,
  viewer: { id: string; name?: string | null; avatar_url?: string | null } | null,
): DmMessage {
  const fromPeer = last.user_id === peer.id;
  const fromViewer = !!viewer && last.user_id === viewer.id;
  return {
    id: last.id,
    content: last.content,
    created_at: last.created_at,
    user_id: last.user_id,
    reply_to_id: null,
    image_url: last.image_url,
    deleted_at: last.deleted_at,
    edited_at: last.edited_at,
    users: fromPeer
      ? { name: peer.name, avatar_url: peer.avatar_url, designation: null }
      : fromViewer
        ? {
            name: viewer.name ?? 'You',
            avatar_url: viewer.avatar_url ?? null,
            designation: null,
          }
        : null,
    reactions: [],
    reply_to: null,
    status: 'sent',
  };
}

/** The fields of a `dm-message` realtime event the list row previews. */
export interface DmRealtimeListMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  content?: string | null;
  image_url?: string | null;
  created_at: string;
}

/**
 * Fold a live message into the list immediately — the row must not wait for
 * the debounced refetch to show what the push already announced. Returns the
 * same array for a conversation the list has not seen yet (the caller then
 * refreshes, because only the server knows the peer's identity).
 */
export function bumpConversationWithMessage(
  conversations: DmConversation[],
  viewerId: string,
  message: DmRealtimeListMessage,
): DmConversation[] {
  const current = conversations.find((row) => row.id === message.conversation_id);
  if (!current) return conversations;
  const isOwn = message.user_id === viewerId;
  const bumped: DmConversation = {
    ...current,
    last_message: {
      id: message.id,
      content: message.content?.trim() ? message.content : null,
      image_url: message.image_url ?? null,
      created_at: message.created_at,
      user_id: message.user_id,
      deleted_at: null,
      edited_at: null,
    },
    last_message_at: message.created_at,
    // A message is newer activity than any reaction.
    last_reaction: null,
    unread_count: isOwn ? current.unread_count : current.unread_count + 1,
  };
  return [bumped, ...conversations.filter((row) => row.id !== current.id)];
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
