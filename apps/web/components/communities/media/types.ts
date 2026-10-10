import { Calendar, MessagesSquare, Sparkles, type LucideIcon } from "lucide-react";

/** Which kind of community content a media item came from. */
export type CommunityMediaSource = "thread" | "showcase" | "event";

/**
 * One entry of the community Media tab, as returned by
 * `get_community_media_page` (thread images, showcase images/videos, event
 * covers — chat images are not a source).
 */
export interface CommunityMediaItem {
  source: CommunityMediaSource;
  source_id: string;
  source_title: string;
  url: string;
  media_type: string;
  /** First-frame JPEG of a video; null for images and poster-less videos. */
  poster: string | null;
  /** Showcase video upload state; null (or absent legacy value) reads as ready. */
  status: string | null;
  /** 1-based attachment position inside the source row (0 for single-image columns). */
  ordinal: number;
  created_at: string;
  user_id: string;
  author: { name: string; avatar_url: string | null } | null;
}

export function isVideoItem(item: CommunityMediaItem): boolean {
  return item.media_type.startsWith("video/");
}

export function isVideoReady(item: CommunityMediaItem): boolean {
  return isVideoItem(item) && (item.status ?? "ready") === "ready";
}

/** Grid thumbnails use a video's poster frame; null renders a play placeholder. */
export function mediaThumbUrl(item: CommunityMediaItem): string | null {
  return isVideoItem(item) ? item.poster : item.url;
}

export const MEDIA_SOURCE_LABELS: Record<CommunityMediaSource, string> = {
  thread: "Thread",
  showcase: "Showcase",
  event: "Event",
};

/** Same icons as the community tabs these sources belong to. */
export const MEDIA_SOURCE_ICONS: Record<CommunityMediaSource, LucideIcon> = {
  thread: MessagesSquare,
  showcase: Sparkles,
  event: Calendar,
};

/** Straight to the content the media belongs to. */
export function mediaSourceHref(communityId: string, item: CommunityMediaItem): string {
  const base = `/dashboard/communities/${communityId}`;
  if (item.source === "thread") return `${base}/threads/${item.source_id}`;
  if (item.source === "showcase") return `${base}/showcase/${item.source_id}`;
  return `${base}/events/${item.source_id}`;
}

export function mediaSourceActionLabel(item: CommunityMediaItem): string {
  if (item.source === "thread") return "Open thread";
  if (item.source === "showcase") return "Open post";
  return "Open event";
}

/** Stable React key / dedupe key for an attachment slot. */
export function mediaItemKey(item: CommunityMediaItem): string {
  return `${item.source}-${item.source_id}-${item.ordinal}`;
}
