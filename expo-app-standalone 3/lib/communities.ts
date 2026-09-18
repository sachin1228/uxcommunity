import { apiFetch, apiFormUpload } from './api';
import type { MentionCandidate, MessageMention, Reaction } from './chat';

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
  /** Present on live payloads; older history-built previews omit it. */
  user_id?: string | null;
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

export async function getMessages(
  communityId: string,
  before?: string
): Promise<Message[]> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  const { data } = await apiFetch<{ messages: Message[] }>(
    `/api/communities/${communityId}/messages${qs}`
  );
  return data.messages;
}

export async function sendMessage(
  communityId: string,
  payload: {
    content?: string;
    reply_to_id?: string;
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
 * Throws a human-readable Error if the server rejects the image or if the
 * moderation service does not return a URL (e.g. content flagged for review).
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
    // Server returned 2xx but without a URL — happens when moderation flags the
    // image for review (HTTP 202) or in other partial-success scenarios.
    throw new Error(data.error ?? 'Image could not be uploaded. Please try a different image.');
  }

  return data.url;
}
