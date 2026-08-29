import { apiFetch } from './api';

interface Author {
  name: string;
  avatar_url: string | null;
}

interface BaseFeedItem {
  id: string;
  community_id: string | null;
  community_name: string | null;
  community_image: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
  users: Author | null;
  comment_count: number;
  like_count: number;
  user_liked: boolean;
  user_saved: boolean;
}

export interface FeedThread extends BaseFeedItem {
  _type: 'thread';
  title: string;
  description: string;
  category: 'question' | 'discussion' | 'idea' | 'feedback' | 'referral' | 'collaboration';
  tags: string[];
  links: string[];
  attachments: { name: string; url: string; type: string; size: number }[];
  allow_replies: boolean;
}

export interface FeedEvent extends BaseFeedItem {
  _type: 'event';
  title: string;
  description: string | null;
  event_date: string;
  end_date: string | null;
  is_online: boolean;
  location: string | null;
  meet_link: string | null;
  max_attendees: number | null;
  cover_image_url: string | null;
  rsvp_count: number;
  save_count: number;
  user_rsvped: boolean;
}

export interface FeedResource extends BaseFeedItem {
  _type: 'resource';
  title: string;
  description: string | null;
  resource_type: 'figma' | 'article' | 'tool' | 'video' | 'book' | 'font' | 'icon_pack' | 'color' | 'template' | 'inspiration' | 'other';
  url: string;
  tags: string[];
  save_count: number;
  bookmark_count: number;
  user_bookmarked: boolean;
}

export interface FeedShowcase extends BaseFeedItem {
  _type: 'showcase';
  title: string;
  description: string;
  image_url: string;
  project_url: string | null;
  category: 'ui_ux' | 'branding' | 'illustration' | 'motion' | 'product' | 'other';
  post_type: 'finished' | 'wip' | 'case_study' | 'feedback';
  tags: string[];
  save_count: number;
}

export type FeedItem = FeedThread | FeedEvent | FeedResource | FeedShowcase;

export interface FeedResponse {
  items: FeedItem[];
}

export async function getHomeFeed(before?: string): Promise<FeedResponse> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const { data } = await apiFetch<FeedResponse>(`/api/home/feed${query}`);
  return data;
}

// ---------------------------------------------------------------------------
// Feed action helpers — same endpoints as the web app
// ---------------------------------------------------------------------------

type FeedContentType = 'threads' | 'events' | 'resources' | 'showcase';

function communityPath(item: FeedItem): string | null {
  if (!item.community_id) return null;
  return `/api/communities/${item.community_id}`;
}

function contentPath(item: FeedItem): string | null {
  const base = communityPath(item);
  if (!base) return null;
  const kind: FeedContentType =
    item._type === 'showcase' ? 'showcase' : `${item._type}s`;
  return `${base}/${kind}/${item.id}`;
}

export async function toggleFeedLike(item: FeedItem): Promise<{ liked: boolean; like_count: number }> {
  const path = contentPath(item);
  if (!path) throw new Error('Cannot like items without a community');
  const { data } = await apiFetch<{ liked: boolean; like_count: number }>(
    `${path}/like`,
    { method: 'POST', body: { liked: !item.user_liked } },
  );
  return data;
}

export async function toggleFeedSave(item: FeedItem): Promise<{ saved: boolean; save_count?: number }> {
  const path = contentPath(item);
  if (!path) throw new Error('Cannot save items without a community');
  const { data } = await apiFetch<{ saved: boolean; save_count?: number }>(
    `${path}/save`,
    { method: 'POST', body: { saved: !item.user_saved } },
  );
  return data;
}

export async function deleteFeedItem(item: FeedItem): Promise<void> {
  const path = contentPath(item);
  if (!path) throw new Error('Cannot delete items without a community');
  await apiFetch(path, { method: 'DELETE' });
}

export async function reportFeedItem(item: FeedItem): Promise<void> {
  await apiFetch('/api/report', {
    method: 'POST',
    body: { content_type: item._type, content_id: item.id },
  });
}
