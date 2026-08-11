import { apiFetch } from './api';

export type CommunityTab = 'chat' | 'threads' | 'events' | 'resources';
export type ContentKind = Exclude<CommunityTab, 'chat'>;

interface Author { name: string; avatar_url: string | null }
interface BaseContent {
  id: string;
  community_id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  users: Author | null;
}

export interface CommunityThread extends BaseContent {
  category: 'question' | 'feedback' | 'showcase' | 'discussion' | 'resource';
  tags: string[];
  links: string[];
  attachments: Array<{ url: string; name: string; type: string; size?: number }>;
  allow_replies: boolean;
  vote_count: number;
  comment_count: number;
  user_voted: boolean;
  user_saved: boolean;
}

export interface CommunityEvent extends BaseContent {
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
  user_saved: boolean;
}

export interface CommunityResource extends BaseContent {
  resource_type: 'figma' | 'article' | 'tool' | 'video' | 'book' | 'font' | 'icon_pack' | 'color' | 'template' | 'inspiration' | 'other';
  url: string;
  tags: string[];
  save_count: number;
  comment_count: number;
  bookmark_count: number;
  user_saved: boolean;
  user_bookmarked: boolean;
}

export type CommunityContent = CommunityThread | CommunityEvent | CommunityResource;
export type ContentByKind = {
  threads: CommunityThread;
  events: CommunityEvent;
  resources: CommunityResource;
};

const responseKey = { threads: 'threads', events: 'events', resources: 'resources' } as const;
const singularKey = { threads: 'thread', events: 'event', resources: 'resource' } as const;

export async function getCommunityContent<K extends ContentKind>(communityId: string, kind: K): Promise<ContentByKind[K][]> {
  const { data } = await apiFetch<Record<string, ContentByKind[K][]>>(`/api/communities/${communityId}/${kind}`);
  return data[responseKey[kind]] ?? [];
}

export async function createCommunityContent<K extends ContentKind>(communityId: string, kind: K, body: Record<string, unknown>): Promise<ContentByKind[K]> {
  const { data } = await apiFetch<Record<string, ContentByKind[K]>>(`/api/communities/${communityId}/${kind}`, { method: 'POST', body });
  return data[singularKey[kind]];
}

export async function updateCommunityContent<K extends ContentKind>(communityId: string, kind: K, itemId: string, body: Record<string, unknown>): Promise<ContentByKind[K]> {
  const { data } = await apiFetch<Record<string, ContentByKind[K]>>(`/api/communities/${communityId}/${kind}/${itemId}`, { method: 'PATCH', body });
  return data[singularKey[kind]];
}

export async function deleteCommunityContent(communityId: string, kind: ContentKind, itemId: string): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/${kind}/${itemId}`, { method: 'DELETE' });
}

export async function toggleContentAction(communityId: string, kind: ContentKind, itemId: string, action: 'vote' | 'save' | 'rsvp' | 'bookmark'): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/${kind}/${itemId}/${action}`, { method: 'POST' });
}
