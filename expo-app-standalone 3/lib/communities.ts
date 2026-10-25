import { apiFetch, apiFormUpload } from './api';
import type { MentionCandidate, MessageMention, Reaction } from './chat';
import type { ChatContentKind } from './chatContentEvents';
import type { CommunityPermissions, CommunityRole } from './communityPermissions';

export type { Reaction };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LastMessage {
  id: string;
  content: string | null;
  created_at: string;
  user: { name: string };
  /** True when the message was sent by the current user (preview shows "You:"). */
  is_own?: boolean;
  is_reply: boolean;
  reply_to_user: string | null;
  /** True when the message was soft-deleted after it became the last preview. */
  is_deleted?: boolean;
  /** True when the message is an image-only post (no text content). */
  has_image?: boolean;
}

export interface LastReaction {
  messageId: string;
  emoji: string;
  createdAt: string;
  firstName: string;
  isOwn: boolean;
  messagePreview: string | null;
}

/**
 * The newest thread/showcase post/resource/event in a community — the sidebar
 * preview and unread-content signal (web `SidebarLastContent`). Unlike the
 * last message it is the newest item regardless of read state, so an opened
 * card still keeps the preview line.
 */
export interface LastContent {
  id: string;
  kind: ChatContentKind;
  created_at: string;
  /** True when the signed-in member is the author ("You created a …"). */
  isOwn: boolean;
  /** The author's first name, or null while unresolved. */
  firstName: string | null;
}

export interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  /** Master-data display name (e.g. the city name for a `city` community). */
  reference_name: string | null;
  is_private: boolean;
  enabled_tabs: string[];
  /**
   * Showcase has its own flag rather than living in `enabled_tabs`, and it
   * defaults to on — a community that predates the flag still shows the tab.
   */
  showcase_enabled?: boolean | null;
  owner_id: string;
  member_count: number;
  message_count: number;
  unread_count: number;
  /** Unread threads/showcase posts/resources/events created by others. */
  unread_content_count?: number;
  last_read_at: string | null;
  joined_at: string;
  is_archived: boolean;
  last_message: LastMessage | null;
  /** The newest content item — previews "john created a thread" when newer. */
  last_content?: LastContent | null;
  lastReaction: LastReaction | null;
  /** An event group chat's own event date — its DP wears it as a badge. */
  event_date?: string | null;
  /** Its event's end while still ahead — what makes the badge say LIVE. */
  pinned_until?: string | null;
  /** That deadline whether ahead or past — what makes the badge say ENDED. */
  event_end?: string | null;
  /** The caller's own mute state — absent on pre-migration rows (not muted). */
  notifications_muted?: boolean | null;
  notifications_muted_until?: string | null;
}

export interface MessageUser {
  name: string;
  avatar_url: string | null;
  designation: string | null;
}

export interface ReplyPreview {
  id: string;
  content: string | null;
  user_name: string;
  /** Present on live payloads and history pages; only old cached rows omit it. */
  user_id?: string | null;
}

/** The "created a …" card a message replies to (the RPC's reply_to_content). */
export interface ContentReplyPreview {
  id: string;
  kind: ChatContentKind;
  title: string;
}

export interface Message {
  id: string;
  content: string | null;
  created_at: string;
  user_id: string;
  reply_to_id: string | null;
  image_url: string | null;
  deleted_at: string | null;
  /** Set when the author edited the text (15-minute window, web parity). */
  edited_at?: string | null;
  /** Members actually mentioned at send time — authoritative for rendering. */
  mentions?: MessageMention[] | null;
  users: MessageUser | null;
  reactions: Reaction[];
  reply_to: ReplyPreview | null;
  /** Set when this message replies to a "created a …" card instead. */
  reply_to_content?: ContentReplyPreview | null;
  /** Client-only — not stored on the server. */
  status?: 'sending' | 'sent' | 'failed';
}

/** Message cursor used by the server's canonical (created_at, id) ordering. */
export interface MessageCursor {
  ts: string;
  id: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * The joined-communities list is opened from three places at once: the tab's
 * own load/reconcile, a chat header resolving its row, and a deep-link screen.
 * These share one short window (and one in-flight request) so opening a chat
 * does not re-download the whole sidebar the tab just fetched.
 *
 * Reconcile and explicit refreshes pass `fresh` — this cache only removes
 * duplicate reads, it never delays a deliberate revalidation.
 */
export const COMMUNITIES_LIST_STALE_MS = 60_000;

let communitiesSnapshot: Community[] | null = null;
let communitiesFetchedAt = 0;
let communitiesInFlight: Promise<Community[]> | null = null;
/**
 * The member this shared copy belongs to. A page fetched for the previous
 * account can settle late; an epoch bump makes it un-storable, so the next
 * member never sees it.
 */
let communitiesActiveUserId: string | null | undefined;
let communitiesEpoch = 0;

export function setCommunitiesActiveUser(userId: string | null): void {
  if (communitiesActiveUserId === userId) return;
  communitiesActiveUserId = userId;
  communitiesEpoch += 1;
  communitiesSnapshot = null;
  communitiesFetchedAt = 0;
  // A new request starts for the new member; the old one is gated by epoch.
  communitiesInFlight = null;
}

/** The last list this process received, synchronously (for first paint). */
export function peekCommunitiesSnapshot(): Community[] | null {
  return communitiesActiveUserId === null ? null : communitiesSnapshot;
}

/** Keep the shared copy in step with the list screen's live state. */
export function putCommunitiesSnapshot(rows: Community[]): void {
  if (communitiesActiveUserId === null) return;
  communitiesSnapshot = rows;
  communitiesFetchedAt = Date.now();
}

/**
 * A launch-time snapshot for the first frame only: it must never count as a
 * fresh read, or a chat header could keep a stale list for the whole window.
 */
export function seedCommunitiesSnapshotFromDisk(rows: Community[]): void {
  if (communitiesActiveUserId === null || communitiesSnapshot) return;
  communitiesSnapshot = rows;
  communitiesFetchedAt = 0;
}

export function patchCommunitiesSnapshot(
  communityId: string,
  patch: Partial<Community> | ((row: Community) => Community),
): void {
  if (communitiesActiveUserId === null || !communitiesSnapshot) return;
  communitiesSnapshot = communitiesSnapshot.map((row) => {
    if (row.id !== communityId) return row;
    return typeof patch === 'function' ? patch(row) : { ...row, ...patch };
  });
}

export function removeFromCommunitiesSnapshot(communityId: string): void {
  if (communitiesActiveUserId === null || !communitiesSnapshot) return;
  communitiesSnapshot = communitiesSnapshot.filter((row) => row.id !== communityId);
}

export function clearCommunitiesSnapshot(): void {
  communitiesActiveUserId = null;
  communitiesEpoch += 1;
  communitiesSnapshot = null;
  communitiesFetchedAt = 0;
  communitiesInFlight = null;
}

export async function getCommunities(
  options: { fresh?: boolean } = {},
): Promise<Community[]> {
  // A stale screen during sign-out has no member to read for.
  if (communitiesActiveUserId === null) return [];

  if (
    !options.fresh &&
    communitiesSnapshot &&
    Date.now() - communitiesFetchedAt < COMMUNITIES_LIST_STALE_MS
  ) {
    return communitiesSnapshot;
  }
  if (communitiesInFlight) return communitiesInFlight;

  const startedEpoch = communitiesEpoch;
  const request = apiFetch<{ communities: Community[] }>('/api/communities')
    .then(({ data }) => {
      // The API returns `message_count` as the server-computed unread-message
      // count. Seed `unread_count` from it so the badge is correct on initial
      // load and after background reconciliation. Realtime events then
      // increment/zero it locally from this baseline.
      //
      // Content notifications (threads / showcase posts / resources / events)
      // travel separately: `unread_content_count` raises the same badge, and
      // `last_content` can take over the preview line — exactly like web.
      const rows = data.communities.map((c) => ({
        ...c,
        unread_count: c.message_count ?? 0,
        unread_content_count: c.unread_content_count ?? 0,
        last_content: c.last_content ?? null,
      }));
      // A late page from the previous account must not repopulate the shared
      // copy for the new one.
      if (startedEpoch === communitiesEpoch) putCommunitiesSnapshot(rows);
      return rows;
    })
    .finally(() => {
      if (communitiesInFlight === request) communitiesInFlight = null;
    });

  communitiesInFlight = request;
  return request;
}

/**
 * One page of a community's messages.
 *
 * `before` walks backwards through history (pagination). `after` returns only
 * what arrived strictly later than the cursor — oldest-first, so the page
 * appends — and is what reconnect/foreground catch-up uses to recover messages
 * published while the socket was down.
 */
export async function getMessages(
  communityId: string,
  before?: string | MessageCursor,
  after?: string | MessageCursor,
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (before) {
    params.set('before', typeof before === 'string' ? before : before.ts);
    if (typeof before !== 'string') params.set('before_id', before.id);
  }
  if (after) {
    params.set('after', typeof after === 'string' ? after : after.ts);
    if (typeof after !== 'string') params.set('after_id', after.id);
  }
  const qs = params.toString();
  const { data } = await apiFetch<{ messages: Message[] }>(
    `/api/communities/${communityId}/messages${qs ? `?${qs}` : ''}`
  );
  return data.messages;
}

export async function sendMessage(
  communityId: string,
  payload: {
    content?: string;
    reply_to_id?: string;
    /**
     * A content-anchored reply (a "created a …" card). Mutually exclusive
     * with `reply_to_id` — the server ignores it when a message anchor is
     * set, because a content id would never validate as a message id.
     */
    reply_to_content?: { id: string; kind: ChatContentKind };
    image_url?: string;
    /** Members picked from the composer's @-autocomplete. */
    mentions?: MessageMention[];
  },
  signal?: AbortSignal
): Promise<Message> {
  const { data } = await apiFetch<{ message: Message }>(
    `/api/communities/${communityId}/messages`,
    { method: 'POST', body: payload as Record<string, unknown>, signal }
  );
  return data.message;
}

/**
 * Set (or clear, with `null`) the signed-in member's reaction on a message.
 *
 * The endpoint takes an explicit desired state — `{ desiredEmoji }` — rather
 * than a toggle, so retries and rapid taps can never invert the final value,
 * and it answers with the authoritative grouped reactions for the message.
 *
 * NOTE: sending `{ emoji }` used to make this a silent no-op (HTTP 422), which
 * is why reactions could not be given from the mobile app at all.
 */
export async function setMessageReaction(
  communityId: string,
  messageId: string,
  desiredEmoji: string | null
): Promise<{ reactions: Reaction[]; currentUserEmoji: string | null }> {
  const { data } = await apiFetch<{
    reactions: Reaction[];
    currentUserEmoji?: string | null;
  }>(`/api/communities/${communityId}/messages/${messageId}/reactions`, {
    method: 'POST',
    body: { desiredEmoji },
  });
  return { reactions: data.reactions ?? [], currentUserEmoji: data.currentUserEmoji ?? desiredEmoji };
}

export async function markRead(communityId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/read`, { method: 'PATCH' });
}

/** The newest created_at per content area — the tab dots' server baseline. */
export interface CommunityContentLatest {
  thread: string | null;
  showcase: string | null;
  resource: string | null;
  event: string | null;
}

/**
 * The newest item per content area (threads / showcase / resources / events),
 * as the server computes it. The chat header's per-tab dots compare these
 * against the member's per-tab watermarks (see hooks/useCommunityTabDots) —
 * the same contract as the web's `/content-latest` baseline.
 */
export async function getContentLatest(communityId: string): Promise<CommunityContentLatest> {
  const { data } = await apiFetch<{ latest?: Partial<CommunityContentLatest> }>(
    `/api/communities/${communityId}/content-latest`
  );
  const latest = data.latest ?? {};
  return {
    thread: latest.thread ?? null,
    showcase: latest.showcase ?? null,
    resource: latest.resource ?? null,
    event: latest.event ?? null,
  };
}

/**
 * Set (or clear, with `null`) the signed-in member's reaction on a chat
 * timeline content card. The same explicit desired-state contract as
 * setMessageReaction — the endpoint answers with the authoritative grouped
 * reactions for the item.
 */
export async function setContentEventReaction(
  communityId: string,
  contentId: string,
  kind: ChatContentKind,
  desiredEmoji: string | null
): Promise<{ reactions: Reaction[]; currentUserEmoji: string | null }> {
  const { data } = await apiFetch<{
    reactions?: Reaction[];
    currentUserEmoji?: string | null;
  }>(`/api/communities/${communityId}/content-events/${contentId}/reactions`, {
    method: 'POST',
    body: { kind, desiredEmoji },
  });
  return { reactions: data.reactions ?? [], currentUserEmoji: data.currentUserEmoji ?? desiredEmoji };
}

/** The durations the mute menu offers, plus "off" to unmute. */
export type CommunityMuteDuration = '8h' | '1w' | 'always' | 'off';

/**
 * Set the caller's own notification mute for one community — the same
 * endpoint the web chat header's bell menu posts to. Answers with the
 * resulting state so callers can patch without recomputing what the server
 * decided.
 */
export async function setCommunityMute(
  communityId: string,
  duration: CommunityMuteDuration
): Promise<{ notifications_muted: boolean; notifications_muted_until: string | null }> {
  const { data } = await apiFetch<{
    notifications_muted?: boolean;
    notifications_muted_until?: string | null;
  }>(`/api/communities/${communityId}/mute`, { method: 'POST', body: { duration } });
  return {
    notifications_muted: Boolean(data.notifications_muted),
    notifications_muted_until: data.notifications_muted_until ?? null,
  };
}

/**
 * "Delete chat" — archives the community for the caller only (the web ⋯
 * menu's first action). Other members are unaffected, and the row reappears
 * when a new message arrives.
 */
export async function archiveCommunity(communityId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/archive`, { method: 'POST' });
}

/**
 * "Exit community" — removes the caller's membership (the web ⋯ menu's
 * second action). When they were the owner, the server transfers ownership to
 * the earliest-joined member, or hard-deletes the community if they were the
 * last member; both outcomes answer with the same success shape.
 */
export async function leaveCommunity(
  communityId: string
): Promise<{ ownershipTransferred: boolean; communityDeleted: boolean }> {
  const { data } = await apiFetch<{
    community_deleted?: boolean;
    ownership_transferred?: boolean;
  }>(`/api/communities/${communityId}/members`, { method: 'DELETE' });
  return {
    ownershipTransferred: Boolean(data.ownership_transferred),
    communityDeleted: Boolean(data.community_deleted),
  };
}

/** The community row the info screen's About section renders (web read model). */
export interface CommunityDetailRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  created_at: string | null;
  image_url: string | null;
  is_private?: boolean | null;
  reference_name?: string | null;
  member_count?: number | null;
  /** The owner's id — the settings flow's privacy/delete gate. */
  owner_id?: string | null;
  /** Only present for the owner; managers regenerate one to read it. */
  invite_token?: string | null;
  enabled_tabs?: string[] | null;
  /** Absent on rows that predate the flag; reads as on. */
  showcase_enabled?: boolean | null;
  /** The signed-in member's effective role and grants (web read model). */
  current_user_role?: CommunityRole | null;
  current_user_permissions?: CommunityPermissions | null;
}

/**
 * The community detail the web client reads for its chat info machinery —
 * description, created date, type and reference name for the About section.
 * Answers `{ community, members, ... }`; the member list on the info screen
 * uses the paged roster below instead, whose rows carry designations.
 */
export async function getCommunityDetail(communityId: string): Promise<CommunityDetailRow | null> {
  const { data } = await apiFetch<{ community?: CommunityDetailRow }>(
    `/api/communities/${communityId}`
  );
  return data.community ?? null;
}

/** One numbered rule on the community info screen (web community_rules row). */
export interface CommunityRule {
  id: string;
  rule_text: string;
  order_index: number;
}

/** The community's rules, in display order (the web right sidebar's Rules). */
export async function getCommunityRules(communityId: string): Promise<CommunityRule[]> {
  const { data } = await apiFetch<{ rules?: CommunityRule[] }>(
    `/api/communities/${communityId}/rules`
  );
  return data.rules ?? [];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface CommunitySettingsInput {
  name: string;
  description: string;
  /** Owner only — the server ignores it for managers. */
  isPrivate?: boolean;
  /** The tabbed areas, showcase excluded (it rides its own flag). */
  tabs: string[];
  showcase: boolean;
  /** Omit to leave the stored rules untouched (e.g. their fetch failed). */
  rules?: string[];
  /** A prepared (WebP, ≤2560px) image from the picker. */
  image?: { uri: string; name: string; type: string } | null;
  removeImage?: boolean;
}

/**
 * Save the community settings — the web CommunitySettingsView's multipart
 * PATCH, same fields and same server validation. Answers the new image URL
 * only when the photo changed.
 */
export async function updateCommunitySettings(
  communityId: string,
  input: CommunitySettingsInput
): Promise<{ image_url?: string | null }> {
  const formData = new FormData();
  formData.append('name', input.name);
  formData.append('description', input.description);
  if (input.isPrivate !== undefined) {
    formData.append('is_private', input.isPrivate ? 'true' : 'false');
  }
  formData.append('tabs', JSON.stringify(input.tabs));
  formData.append('showcase', input.showcase ? 'true' : 'false');
  if (input.rules !== undefined) formData.append('rules', JSON.stringify(input.rules));
  if (input.image) {
    formData.append('image', {
      uri: input.image.uri,
      type: normaliseMimeType(input.image.type),
      name: input.image.name,
    } as unknown as Blob);
  } else if (input.removeImage) {
    formData.append('remove_image', 'true');
  }

  const { data } = await apiFormUpload<{ image_url?: string | null; error?: string }>(
    `/api/communities/${communityId}`,
    formData,
    undefined,
    'PATCH'
  );
  return { image_url: data?.image_url };
}

/** Invalidate the community's invite token; answers the new link. */
export async function regenerateCommunityInvite(
  communityId: string
): Promise<{ invite_token: string; invite_url: string }> {
  const { data } = await apiFetch<{ invite_token?: string; invite_url?: string }>(
    `/api/communities/${communityId}/invite/regenerate`,
    { method: 'POST' }
  );
  return {
    invite_token: data.invite_token ?? '',
    invite_url: data.invite_url ?? '',
  };
}

/** Permanently delete the community (owner only, soft-delete server-side). */
export async function deleteCommunity(communityId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Members, requests and management activity
// ---------------------------------------------------------------------------

/** One roster row as the Members tab manages it (web MembersView row). */
export interface CommunityMemberRow {
  user_id: string;
  name: string;
  avatar_url: string | null;
  designation: string | null;
  joined_at: string;
  role: CommunityRole | string;
  /** Effective grants — only sent for moderators to the manager tier. */
  permissions?: CommunityPermissions | null;
}

/** A pending join request on a private community. */
export interface CommunityJoinRequest {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  requested_at: string;
  request_message: string | null;
}

/**
 * One page of the roster with roles (and moderator grants for the manager
 * tier). The server owns the 30-row page size and applies the search filter.
 */
export async function getCommunityMembersDetailed(
  communityId: string,
  page = 0,
  search = ''
): Promise<{ members: CommunityMemberRow[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set('search', search);
  const { data } = await apiFetch<{
    members?: CommunityMemberRow[];
    has_more?: boolean;
    total?: number;
  }>(`/api/communities/${communityId}/members?${params.toString()}`);
  return {
    members: data.members ?? [],
    hasMore: data.has_more ?? false,
    total: data.total ?? 0,
  };
}

export async function getCommunityJoinRequests(
  communityId: string
): Promise<CommunityJoinRequest[]> {
  const { data } = await apiFetch<{ requests?: CommunityJoinRequest[] }>(
    `/api/communities/${communityId}/requests`
  );
  return data.requests ?? [];
}

export async function acceptCommunityJoinRequest(
  communityId: string,
  requestId: string
): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/requests/${requestId}/accept`, {
    method: 'POST',
  });
}

export async function declineCommunityJoinRequest(
  communityId: string,
  requestId: string
): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/requests/${requestId}/decline`, {
    method: 'POST',
  });
}

/**
 * Promote a member to moderator (with grants), re-apply a moderator's grants,
 * or dismiss them with `role: "member"`.
 */
export async function updateCommunityMemberRole(
  communityId: string,
  userId: string,
  body:
    | { role: 'moderator'; permissions?: CommunityPermissions }
    | { role: 'member' }
): Promise<{ role: string; permissions: CommunityPermissions | null }> {
  const { data } = await apiFetch<{
    member?: { role?: string; permissions?: CommunityPermissions | null };
  }>(`/api/communities/${communityId}/members/${userId}`, {
    method: 'PATCH',
    body: body as Record<string, unknown>,
  });
  return {
    role: data.member?.role ?? body.role,
    permissions: data.member?.permissions ?? null,
  };
}

export async function removeCommunityMember(
  communityId: string,
  userId: string
): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/members/${userId}`, {
    method: 'DELETE',
  });
}

/** One row of the community's management audit trail. */
export interface CommunityActivityEntry {
  id: string;
  community_id: string;
  actor_id: string | null;
  /** Only the manager tier writes here — never a plain member. */
  actor_role: 'owner' | 'admin' | 'moderator' | 'platform';
  actor_name: string | null;
  actor_avatar_url?: string | null;
  action: string;
  target_user_id: string | null;
  target_user_name?: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** Keyset-paginated activity page for the manager-tier Activity tab. */
export async function getCommunityActivity(
  communityId: string,
  before?: string
): Promise<{ activity: CommunityActivityEntry[]; hasMore: boolean }> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  const { data } = await apiFetch<{ activity?: CommunityActivityEntry[]; has_more?: boolean }>(
    `/api/communities/${communityId}/activity${qs}`
  );
  return { activity: data.activity ?? [], hasMore: Boolean(data.has_more) };
}

/** One member's recorded answers to an event's compulsory join questions. */
export interface EventJoinResponseRow {
  user_id: string;
  why_attend: string;
  expectations: string;
  created_at: string;
}

export async function getEventJoinResponses(
  communityId: string
): Promise<EventJoinResponseRow[]> {
  const { data } = await apiFetch<{ responses?: EventJoinResponseRow[] }>(
    `/api/communities/${communityId}/event-join-responses`
  );
  return data.responses ?? [];
}

/** The community the create flow just made. */
export interface CreatedCommunity {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  is_private: boolean;
  enabled_tabs: string[];
  member_count: number;
  invite_url: string;
}

export interface CreateCommunityInput {
  name: string;
  isPrivate: boolean;
  description: string;
  /** Tab areas to enable (the create form's areas, showcase excluded). */
  tabs: string[];
  /** Showcase has its own column rather than living in `enabled_tabs`. */
  showcase: boolean;
  rules: string[];
  /** A prepared (WebP, ≤2560px) image from the picker; optional. */
  image?: { uri: string; name: string; type: string } | null;
}

/**
 * Create a community — the web CreateCommunityModal's multipart contract.
 * The creator joins as owner server-side; creation caps (own communities,
 * total joins) answer 429 with a human message, which apiFormUpload surfaces
 * as the thrown Error's message.
 */
export async function createCommunity(input: CreateCommunityInput): Promise<CreatedCommunity> {
  const formData = new FormData();
  formData.append('name', input.name);
  formData.append('privacy', input.isPrivate ? 'private' : 'public');
  formData.append('description', input.description);
  formData.append('tabs', JSON.stringify(input.tabs));
  formData.append('showcase', input.showcase ? 'true' : 'false');
  formData.append('rules', JSON.stringify(input.rules));
  if (input.image) {
    formData.append('image', {
      uri: input.image.uri,
      type: normaliseMimeType(input.image.type),
      name: input.image.name,
    } as unknown as Blob);
  }

  const { data } = await apiFormUpload<{ community?: CreatedCommunity; error?: string }>(
    '/api/communities',
    formData
  );
  if (!data.community) {
    throw new Error(data.error ?? 'Failed to create community.');
  }
  return data.community;
}

export async function deleteMessage(
  communityId: string,
  messageId: string
): Promise<void> {
  await apiFetch(
    `/api/communities/${communityId}/messages/${messageId}`,
    { method: 'DELETE' }
  );
}

/**
 * Edit the text of an owned message. Images and reply metadata are kept as-is;
 * the client only offers this within MESSAGE_EDIT_WINDOW_MS of sending.
 *
 * Returns the server's `edited_at` so the bubble can label itself immediately
 * (the realtime `message-edit` event reconciles everyone else).
 */
export async function editMessage(
  communityId: string,
  messageId: string,
  content: string
): Promise<{ edited_at: string | null }> {
  const { data } = await apiFetch<{ message?: { edited_at?: string | null }; edited_at?: string | null }>(
    `/api/communities/${communityId}/messages/${messageId}`,
    { method: 'PATCH', body: { content } }
  );
  return { edited_at: data.message?.edited_at ?? data.edited_at ?? new Date().toISOString() };
}

/**
 * One member's display info, resolved lazily from the lightweight member
 * endpoint for realtime rows that carry only a user_id — the community list's
 * sender names resolve through the same route, and the chat's "created a …"
 * cards resolve their live authors through it. Null when the member cannot be
 * resolved (deleted user, offline), so callers decide the fallback label.
 */
export async function getMemberBrief(
  communityId: string,
  userId: string
): Promise<{ name: string; avatar_url: string | null } | null> {
  try {
    const { data } = await apiFetch<{ name?: string; avatar_url?: string | null }>(
      `/api/communities/${communityId}/members/${userId}`
    );
    if (!data?.name) return null;
    return { name: data.name, avatar_url: data.avatar_url ?? null };
  } catch {
    return null;
  }
}

/**
 * Community member roster for the composer's @-autocomplete.
 *
 * The endpoint pages at 30 rows, so page through until it runs out (bounded)
 * to keep every member mentionable — the web popover filters the roster
 * locally for the same reason.
 */
export async function getCommunityMembers(
  communityId: string,
  maxMembers = 200,
): Promise<MentionCandidate[]> {
  const all: MentionCandidate[] = [];
  for (let page = 0; all.length < maxMembers; page += 1) {
    const { data } = await apiFetch<{ members?: MentionCandidate[]; has_more?: boolean }>(
      `/api/communities/${communityId}/members?page=${page}`,
    );
    const batch = data.members ?? [];
    all.push(...batch);
    if (!data.has_more || batch.length === 0) break;
  }
  return all.slice(0, maxMembers);
}

/**
 * One page of a community's member roster. The server owns the page size
 * (30 rows — see the web members route), so a screen only ever transfers what
 * it shows instead of walking the whole membership.
 */
export async function getCommunityMembersPage(
  communityId: string,
  page = 0,
): Promise<{ members: MentionCandidate[]; hasMore: boolean }> {
  const { data } = await apiFetch<{ members?: MentionCandidate[]; has_more?: boolean }>(
    `/api/communities/${communityId}/members?page=${page}`,
  );
  return { members: data.members ?? [], hasMore: data.has_more ?? false };
}

/**
 * Normalise MIME types to the subset the upload API accepts.
 * Android devices sometimes report non-standard variants (e.g. "image/jpg")
 * that would be rejected by the server's ALLOWED_TYPES check.
 */
function normaliseMimeType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (lower === 'image/jfif') return 'image/jpeg';
  if (lower === 'image/pjpeg') return 'image/jpeg';
  if (lower === 'image/x-png') return 'image/png';
  return lower;
}

/**
 * Upload a local image URI to the chat image endpoint.
 * Uses React Native's multipart FormData object format { uri, type, name }.
 * Returns the permanent CDN URL to embed in the message payload.
 *
 * Throws a human-readable Error if the server rejects the image or the upload
 * completes without returning a CDN URL.
 */
export async function uploadChatImage(
  communityId: string,
  imageUri: string,
  mimeType: string = 'image/jpeg',
  signal?: AbortSignal
): Promise<string> {
  const normalised = normaliseMimeType(mimeType);
  const ext = normalised.split('/')[1] ?? 'jpg';

  const formData = new FormData();
  // React Native multipart upload — append as a file descriptor object
  formData.append('file', {
    uri: imageUri,
    type: normalised,
    name: `chat-image.${ext}`,
  } as unknown as Blob);

  const { data } = await apiFormUpload<{ url?: string; error?: string }>(
    `/api/communities/${communityId}/messages/upload`,
    formData,
    signal
  );

  if (!data.url) {
    // Server returned 2xx but without a URL — the upload could not be stored.
    throw new Error(data.error ?? 'Image could not be uploaded. Please try a different image.');
  }

  return data.url;
}
