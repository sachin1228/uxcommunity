import { apiFetch, apiFormUpload } from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LastMessage {
  id: string;
  content: string | null;
  created_at: string;
  user: { name: string };
  is_reply: boolean;
  reply_to_user: string | null;
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
  is_private: boolean;
  enabled_tabs: string[];
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
  company: string | null;
}

export interface Reaction {
  emoji: string;
  user_ids: string[];
}

export interface ReplyPreview {
  id: string;
  content: string | null;
  user_name: string;
}

export interface Message {
  id: string;
  content: string | null;
  created_at: string;
  user_id: string;
  reply_to_id: string | null;
  image_url: string | null;
  deleted_at: string | null;
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
  payload: { content?: string; reply_to_id?: string; image_url?: string },
  signal?: AbortSignal
): Promise<Message> {
  const { data } = await apiFetch<{ message: Message }>(
    `/api/communities/${communityId}/messages`,
    { method: 'POST', body: payload as Record<string, unknown>, signal }
  );
  return data.message;
}

export async function toggleReaction(
  communityId: string,
  messageId: string,
  emoji: string
): Promise<Reaction[]> {
  const { data } = await apiFetch<{ reactions: Reaction[] }>(
    `/api/communities/${communityId}/messages/${messageId}/reactions`,
    { method: 'POST', body: { emoji } }
  );
  return data.reactions;
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
