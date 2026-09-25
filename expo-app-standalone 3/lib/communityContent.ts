import { apiFetch, apiFormUpload } from './api';

/**
 * Community content client — threads, showcase posts, events and resources.
 *
 * Mirrors the web card action contracts exactly:
 *   • every interaction is an explicit desired state (`{ liked: true }`), never
 *     a toggle, so a retry can't invert the result;
 *   • threads/events/resources each spell the response count differently;
 *   • showcase uses one generic `{ action, active }` endpoint for like + save.
 *
 * Comments live in ./comments.
 */

export type CommunityTab = 'chat' | 'threads' | 'showcase' | 'events' | 'resources';
export type ContentKind = Exclude<CommunityTab, 'chat'>;

/** Every interaction the cards expose, per web parity. */
export type ContentAction = 'like' | 'save' | 'rsvp' | 'bookmark';

interface Author { name: string; avatar_url: string | null }

interface BaseContent {
  id: string;
  community_id: string;
  user_id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  users: Author | null;
}

export interface ThreadAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
  /** First-frame image for video attachments (showcase only). */
  poster?: string;
  mediaId?: string;
  status?: string;
}

export interface CommunityThread extends BaseContent {
  category: 'question' | 'discussion' | 'idea' | 'feedback' | 'referral' | 'collaboration';
  tags: string[];
  links: string[];
  attachments: ThreadAttachment[];
  allow_replies: boolean;
  like_count: number;
  comment_count: number;
  user_liked: boolean;
  user_saved: boolean;
}

export interface CommunityEvent extends BaseContent {
  event_date: string;
  end_date: string | null;
  /**
   * The zone the host set the event in. Null on events that predate the
   * column, and on any create that could not name a zone.
   */
  host_timezone: string | null;
  is_online: boolean;
  location: string | null;
  meet_link: string | null;
  max_attendees: number | null;
  cover_image_url: string | null;
  rsvp_count: number;
  like_count: number;
  save_count: number;
  user_rsvped: boolean;
  user_liked: boolean;
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

export interface CommunityShowcase extends BaseContent {
  image_url: string;
  category: string;
  allow_replies: boolean;
  attachments: ThreadAttachment[];
  like_count: number;
  comment_count: number;
  user_liked: boolean;
  user_saved: boolean;
  /** Showcase posts hydrate their author as `author`, not `users`. */
  author?: Author | null;
}

export type CommunityContent =
  | CommunityThread
  | CommunityEvent
  | CommunityResource
  | CommunityShowcase;

export type ContentByKind = {
  threads: CommunityThread;
  showcase: CommunityShowcase;
  events: CommunityEvent;
  resources: CommunityResource;
};

/** Showcase categories — single source of truth, matches the web list. */
export const SHOWCASE_CATEGORY_OPTIONS = [
  { value: 'product_design', label: 'Product Design' },
  { value: 'ai_design', label: 'AI design' },
  { value: 'ux_research', label: 'UX Research' },
  { value: 'ui_design', label: 'UI Design' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'case_study', label: 'Case study' },
  { value: 'graphic_design', label: 'Graphic Design' },
  { value: 'motion_design', label: 'Motion Design' },
  { value: 'illustration', label: 'Illustration' },
  { value: '3d_design', label: '3D Design' },
  { value: 'other', label: 'Other' },
] as const;

/** Max images/videos on one showcase post (web `SHOWCASE_MEDIA_MAX`). */
export const SHOWCASE_MEDIA_MAX = 5;

const responseKey: Record<ContentKind, string> = {
  threads: 'threads',
  showcase: 'posts',
  events: 'events',
  resources: 'resources',
};

const singularKey: Record<ContentKind, string> = {
  threads: 'thread',
  showcase: 'post',
  events: 'event',
  resources: 'resource',
};

/** Human label for a kind — used in headers, empty states and the editor. */
export function contentLabel(kind: ContentKind): string {
  switch (kind) {
    case 'threads': return 'Thread';
    case 'showcase': return 'Showcase post';
    case 'events': return 'Event';
    case 'resources': return 'Resource';
  }
}

/** The author of a card, whichever shape the API hydrated. */
export function contentAuthor(item: CommunityContent): Author | null {
  return (item as CommunityShowcase).author ?? item.users ?? null;
}

/**
 * Thread categories with their display labels — the web `THREAD_CATEGORIES`
 * plus the two categories the mobile composer also offers.
 */
export const THREAD_CATEGORY_LABELS: Record<string, string> = {
  question: 'Question',
  discussion: 'Discussion',
  idea: 'Idea',
  feedback: 'Feedback',
  referral: 'Referral',
  collaboration: 'Collaboration',
};

/** Resource types with their display labels (web `RESOURCE_TYPES`). */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  figma: 'Figma',
  article: 'Article',
  tool: 'Tool',
  video: 'Video',
  book: 'Book',
  font: 'Font',
  icon_pack: 'Icon Pack',
  color: 'Color',
  template: 'Template',
  inspiration: 'Inspiration',
  other: 'Other',
};

function showcaseCategoryLabel(value: string): string {
  return SHOWCASE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/**
 * The muted second line under the author in every card — "Threads · Discussion",
 * "Resources · Figma", "Event · Online", "Showcase · UI Design". Same strings as
 * the web cards, which is where the category lives on the web (there is no
 * category pill).
 */
export function contentSecondaryLabel(kind: ContentKind, item: CommunityContent): string {
  if (kind === 'threads') {
    const thread = item as CommunityThread;
    return `Threads · ${THREAD_CATEGORY_LABELS[thread.category] ?? 'Post'}`;
  }
  if (kind === 'resources') {
    const resource = item as CommunityResource;
    return `Resources · ${RESOURCE_TYPE_LABELS[resource.resource_type] ?? 'Post'}`;
  }
  if (kind === 'showcase') {
    const showcase = item as CommunityShowcase;
    return `Showcase · ${showcaseCategoryLabel(showcase.category)}`;
  }
  const event = item as CommunityEvent;
  if (event.is_online) return 'Event · Online';
  return event.location ? `Event · ${event.location}` : 'Event';
}

/** "3h ago" — the web `formatRelativeDate` from threads/threadShared. */
export function formatRelativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * How many lines a card body is collapsed to before "Read more".
 *
 * Threads follow the web rule exactly: 5 lines for a text-only thread, 2 as
 * soon as there is an attachment (the body is then competing with media), and
 * the same 2 serves events and resources.
 */
export function collapsedBodyLines(kind: ContentKind, item: CommunityContent): number {
  if (kind === 'threads') {
    const thread = item as CommunityThread;
    return (thread.attachments?.length ?? 0) === 0 ? 5 : 2;
  }
  return 2;
}

export async function getCommunityContent<K extends ContentKind>(
  communityId: string,
  kind: K,
): Promise<ContentByKind[K][]> {
  const { data } = await apiFetch<Record<string, ContentByKind[K][]>>(
    `/api/communities/${communityId}/${kind}`,
  );
  return data[responseKey[kind]] ?? [];
}

export async function createCommunityContent<K extends ContentKind>(
  communityId: string,
  kind: K,
  body: Record<string, unknown>,
): Promise<ContentByKind[K]> {
  const { data } = await apiFetch<Record<string, ContentByKind[K]>>(
    `/api/communities/${communityId}/${kind}`,
    { method: 'POST', body },
  );
  return data[singularKey[kind]];
}

export async function updateCommunityContent<K extends ContentKind>(
  communityId: string,
  kind: K,
  itemId: string,
  body: Record<string, unknown>,
): Promise<ContentByKind[K]> {
  const { data } = await apiFetch<Record<string, ContentByKind[K]>>(
    `/api/communities/${communityId}/${kind}/${itemId}`,
    { method: 'PATCH', body },
  );
  return data[singularKey[kind]];
}

export async function deleteCommunityContent(
  communityId: string,
  kind: ContentKind,
  itemId: string,
): Promise<void> {
  await apiFetch(`/api/communities/${communityId}/${kind}/${itemId}`, { method: 'DELETE' });
}

export interface ActionResult {
  /** The authoritative state the server confirmed. */
  value: boolean;
  /** The server's count for that interaction, when it reports one. */
  count?: number;
}

/**
 * Persist one interaction with an explicit desired state.
 *
 * Returns the confirmed value (and count where the endpoint reports one) so the
 * caller can reconcile an optimistic update instead of guessing.
 */
export async function setContentAction(
  communityId: string,
  kind: ContentKind,
  itemId: string,
  action: ContentAction,
  desired: boolean,
): Promise<ActionResult> {
  if (kind === 'showcase') {
    const { data } = await apiFetch<{ active?: boolean; count?: number }>(
      `/api/communities/${communityId}/showcase/${itemId}`,
      { method: 'POST', body: { action: action === 'like' ? 'like' : 'save', active: desired } },
    );
    return { value: data.active ?? desired, count: data.count };
  }

  if (action === 'rsvp') {
    const { data } = await apiFetch<{ rsvped?: boolean; rsvp_count?: number }>(
      `/api/communities/${communityId}/${kind}/${itemId}/rsvp`,
      { method: 'POST', body: {} },
    );
    return { value: data.rsvped ?? desired, count: data.rsvp_count };
  }

  const bodyKey = action === 'like' ? 'liked' : action === 'bookmark' ? 'bookmarked' : 'saved';
  const responseKeyForAction =
    action === 'like' ? 'liked' : action === 'bookmark' ? 'bookmarked' : 'saved';
  const countKey = action === 'like' ? 'count' : action === 'bookmark' ? 'bookmark_count' : 'save_count';

  const { data } = await apiFetch<Record<string, unknown>>(
    `/api/communities/${communityId}/${kind}/${itemId}/${action}`,
    { method: 'POST', body: { [bodyKey]: desired } },
  );

  const confirmed = data[responseKeyForAction];
  const count = data[countKey] ?? data.like_count;
  return {
    value: typeof confirmed === 'boolean' ? confirmed : desired,
    count: typeof count === 'number' ? count : undefined,
  };
}

export async function getLinkPreviewImage(url: string): Promise<string | null> {
  const { data } = await apiFetch<{ image?: string | null }>(
    `/api/link-preview?url=${encodeURIComponent(url)}`,
  );
  return data.image ?? null;
}

/**
 * Upload one image for any content kind.
 *
 * Threads, showcase and event/resource uploads all accept the same multipart
 * `file` field and answer with an `attachment`; showcase additionally returns
 * the bare `url`.
 */
export async function uploadContentImage(
  communityId: string,
  kind: ContentKind,
  image: { uri: string; name: string; type: string },
): Promise<ThreadAttachment> {
  const formData = new FormData();
  formData.append('file', image as unknown as Blob);
  const { data } = await apiFormUpload<{ attachment?: ThreadAttachment; url?: string }>(
    `/api/communities/${communityId}/${kind}/upload`,
    formData,
  );
  if (data.attachment) return data.attachment;
  if (data.url) {
    return { url: data.url, name: image.name, type: image.type, size: 0 };
  }
  throw new Error('Image could not be uploaded. Please try a different image.');
}
