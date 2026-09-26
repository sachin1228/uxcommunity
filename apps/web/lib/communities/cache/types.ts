import type { MessageMention } from "../mentions";
import type { ContentEventMeta } from "../content-notifications";

export type { MessageMention } from "../mentions";

export interface MessageReaction {
  emoji: string;
  user_ids: string[];
}

/** Snapshot of the message being replied to, embedded in the reply bubble. */
export interface ReplyPreview {
  id: string;
  content: string;
  user_name: string;
  /** Parent author's id when known — drives the reply-name color. History
   * rows built by the SQL RPC omit it (the RPC only embeds the name). */
  user_id?: string | null;
  /** Set when the reply anchors to a content item (a "created a …" card)
   * instead of a chat message — `id` is then the content item's id. */
  content_kind?: ContentEventKind | null;
  /** Card title for content-anchored replies (rendered in the composer chip). */
  content_title?: string | null;
}

/** Preview of a content item being replied to (a "created a …" card). */
export interface ContentReplyPreview {
  id: string;
  kind: ContentEventKind;
  title: string;
}
export interface CachedMessage {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  users: { name: string; avatar_url: string | null; designation?: string | null } | null;
  status?: "sending" | "sent" | "failed";
  reactions?: MessageReaction[];
  reply_to?: ReplyPreview | null;
  /** Set when the reply anchors to a content item instead of a message. */
  reply_to_content?: ContentReplyPreview | null;
  image_url?: string | null;
  deleted_at?: string | null;
  edited_at?: string | null;
  /** Members @mentioned in this message — `@Name` tokens in `content`. */
  mentions?: MessageMention[];
}

/** A thread-created event shown inline in the chat timeline. */
export interface CachedThreadEvent {
  id: string;           // thread id
  community_id: string;
  user_id: string;
  title: string;
  category: string;
  attachments: Array<{ name: string; url: string; type: string; size: number; poster?: string }>;
  created_at: string;
  users: { name: string; avatar_url: string | null } | null;
  /** Discussion on the thread's detail page (count + newest commenters), so
   * the thread card can show it like the other three kinds. */
  meta?: ContentEventMeta | null;
  /** Emoji reactions left on the card (grouped, message-reaction shape). */
  reactions?: MessageReaction[];
}

/**
 * Which community area a content notification belongs to. The chat timeline
 * renders one shared "<name> created a …" card for all four kinds.
 */
export type ContentEventKind = "thread" | "showcase" | "resource" | "event";

/**
 * A "John created a …" event shown inline in the chat timeline. Unlike the
 * legacy thread-only event this is persisted server-side, so it is permanent —
 * it reappears from history on every visit, exactly like a normal message.
 */
export interface CachedContentEvent {
  /** The id of the thread/showcase post/resource/event itself. */
  id: string;
  community_id: string;
  user_id: string;
  kind: ContentEventKind;
  title: string;
  created_at: string;
  users: { name: string; avatar_url: string | null } | null;
  /** Optional rich fields (thumbnail, description, schedule…) the card renders. */
  meta?: ContentEventMeta | null;
  /** Emoji reactions left on the card (grouped, message-reaction shape). */
  reactions?: MessageReaction[];
}

/** Effective community-management grants for the current user. */
export interface ClientCommunityPermissions {
  can_edit_settings?: boolean;
  can_manage_members?: boolean;
  can_delete_messages?: boolean;
}

export interface CachedMeta {
  community: {
    id: string;
    name: string;
    type: string;
    member_count: number;
    image_url: string | null;
    is_private?: boolean;
    enabled_tabs?: string[];
    /** Showcase flag — absent on rows that predate it, which read as on. */
    showcase_enabled?: boolean | null;
    owner_id?: string | null;
    invite_token?: string | null;
    description?: string | null;
    created_at?: string;
    /**
     * An event group chat's own event date — the day the room is for, worn as
     * the calendar badge on its DP (see components/communities/DpWithEventDate).
     * Absent on every other kind of community. Matches the sidebar row's field
     * of the same name so a header painting before the meta arrives can borrow
     * the sidebar entry's copy.
     */
    event_date?: string | null;
    /**
     * The deadline an event room stops being pinned at — its event's end, which
     * is also when its badge stops saying LIVE. Sent only while still ahead,
     * like the sidebar row's field of the same name.
     */
    pinned_until?: string | null;
    /** That deadline whether ahead or past — the badge's ENDED day reads it. */
    event_end?: string | null;
    /** "owner" | "admin" | "member" — the current user's role in this community. */
    current_user_role?: string | null;
    /** Effective permission grants (owners: everything; admins: configured toggles). */
    current_user_permissions?: ClientCommunityPermissions | null;
  };
  members: {
    user_id: string;
    role?: string;
    users: { name: string; avatar_url: string | null; designation?: string | null } | null;
  }[];
  fetchedAt: number;
}

// ─── Sidebar joined-communities cache ─────────────────────────────────────────

export interface SidebarLastReaction {
  /** Message that received the reaction — or the content card's id. */
  messageId: string;
  emoji: string;
  /** Used to ignore delayed realtime responses for older reactions. */
  createdAt?: string;
  /** First name of the person who reacted (or "You" if isOwn). */
  firstName: string;
  isOwn: boolean;
  /** Content snippet of the message that was reacted to. */
  messagePreview: string;
  /** Set when the reaction was left on a "created a …" card (thread /
   * showcase / resource / event) instead of a chat message. */
  contentKind?: ContentEventKind | null;
}

export interface CachedSidebarCommunity {
  id: string;
  name: string;
  /** `event` rows are an event's group chat (see lib/communities/event-chat). */
  type: "city" | "sector" | "interest" | "experience_level" | "job_title" | "general" | "user" | "event";
  image_url: string | null;
  reference_name?: string | null;
  is_private?: boolean;
  enabled_tabs?: string[];
  /** Showcase flag — absent on rows that predate it, which read as on. */
  showcase_enabled?: boolean | null;
  owner_id?: string | null;
  created_at?: string | null;
  joined_at?: string | null;
  member_count: number;
  message_count: number;
  /** Unread messages that @mentioned this user — raises the row's "@" mark. */
  mention_count?: number;
  /** Unread threads/showcase posts/resources/events created by others. */
  unread_content_count?: number;
  /** Hidden by this user until a new message arrives. */
  is_archived?: boolean;
  /**
   * An event group chat's own event date — the day the room is for. Rendered as
   * the date badge on its sidebar DP (see lib/communities/event-date), and kept
   * after the event has passed. Absent on every other kind of community.
   */
  event_date?: string | null;
  /**
   * Set on an event's group chat while its event is still ahead: the room is
   * pinned to the top of the sidebar until then. Absent once the event has
   * passed, so ordering only has to test presence (see sidebar-order.ts).
   */
  pinned_until?: string | null;
  /**
   * That same deadline whether ahead or past — the event's end, or its start
   * when it has none. Outlives the pin so the DP's badge can say ENDED for a
   * day after the event wraps (see lib/communities/event-date). Absent on
   * every other kind of community.
   */
  event_end?: string | null;
  last_read_at?: string | null;
  /** Most recent reaction event — shown in the preview instead of last_message when set. Cleared when a new message arrives. */
  lastReaction?: SidebarLastReaction | null;
  /** Newest thread/showcase/resource/event — previewed as "john created a thread" etc. */
  last_content?: SidebarLastContent | null;
  last_message: {
    id: string;
    content: string;
    created_at: string;
    user: { name: string } | null;
    /** True when the message was sent by the current user (preview shows "You:"). */
    is_own?: boolean;
    /** True when the message was soft-deleted after it became the last preview. */
    is_deleted?: boolean;
    /** True when the message is an image-only post (no text content). */
    has_image?: boolean;
    /** True when the message is a reply to another message. */
    is_reply?: boolean;
    /** First name of the user whose message was replied to. */
    reply_to_user?: string | null;
    /** Set when the reply anchors to a "created a …" card instead of a
     * message — the sidebar previews "replied to a thread: …". */
    reply_to_content_kind?: ContentEventKind | null;
    /** Unique emoji strings that have been reacted to this message. */
    reactions?: string[];
  } | null;
}

export interface SidebarLastContent {
  id: string;
  kind: ContentEventKind;
  title: string;
  created_at: string;
  /** True when the current user created it (preview shows "You"). */
  isOwn?: boolean;
  /** Author's first name, resolved client-side after a realtime event. */
  firstName?: string | null;
}

export interface CachedExploreCommunity {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "experience_level" | "job_title" | "general" | "user" | "event";
  image_url: string | null;
  description: string | null;
  is_private?: boolean;
  member_count: number;
  joined: boolean;
  /** Whether the current user is allowed to join this community based on their profile. */
  can_join: boolean;
  /** Whether the user has a pending join request for this private community. */
  has_pending_request?: boolean;
}
