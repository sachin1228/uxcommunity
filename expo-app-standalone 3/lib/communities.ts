import { apiFetch, apiFormUpload } from './api';
import type { MentionCandidate, MessageMention, Reaction } from './chat';
import type { ChatContentKind } from './chatContentEvents';

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
  last_read_at: string | null;
  joined_at: string;
  is_archived: boolean;
  last_message: LastMessage | null;
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

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function getCommunities(): Promise<Community[]> {
  const { data } = await apiFetch<{ communities: Community[] }>('/api/communities');
  // The API returns `message_count` as the server-computed unread count.
  // Seed `unread_count` from it so the badge is correct on initial load and
  // after background reconciliation. Realtime events then increment/zero it
  // locally from this baseline.
  return data.communities.map((c) => ({
    ...c,
    unread_count: c.message_count ?? 0,
  }));
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
  before?: string,
  after?: string
): Promise<Message[]> {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (after) params.set('after', after);
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
