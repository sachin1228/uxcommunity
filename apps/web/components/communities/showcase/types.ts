import {
  SHOWCASE_CATEGORY_OPTIONS,
  type ShowcaseCategory,
} from "@/lib/communities/showcase-categories";

export { SHOWCASE_CATEGORY_OPTIONS };
export type { ShowcaseCategory };

/** "All work" + every category — drives the showcase filter row. */
export const SHOWCASE_CATEGORIES: { value: ShowcaseCategory | "all"; label: string }[] = [
  { value: "all", label: "All work" },
  ...SHOWCASE_CATEGORY_OPTIONS,
];

/** Max title (body) length — mirrors the DB column + API validation. */
export const SHOWCASE_TITLE_MAX_LENGTH = 2000;

/** How many media items (images + videos) a showcase post may carry. */
export const SHOWCASE_MEDIA_MAX = 5;

export type VideoAttachmentStatus = "ready" | "failed";

/** Uploaded image/video attachment — mirrors the thread attachment shape. */
export interface ShowcaseAttachment {
  name: string;
  url: string;
  type: string;
  size: number;
  /** First-frame JPEG shown while the video streams in (videos only). */
  poster?: string;
  /** Client-generated upload ID (videos only; kept for keying feed entries). */
  mediaId?: string;
  /**
   * Upload state for video attachments. Videos are plain uploads — they are
   * `ready` the moment the upload completes. Absent on legacy attachments —
   * treated as ready.
   */
  status?: VideoAttachmentStatus;
  /** Human-readable failure detail (composer-local, never persisted). */
  errorMessage?: string;
}

/** True when a video attachment is ready to render/play. */
export function isVideoReady(attachment: ShowcaseAttachment): boolean {
  return attachment.type.startsWith("video/") && (attachment.status ?? "ready") === "ready";
}

export interface ShowcasePost {
  id: string; community_id: string; user_id: string; title: string;
  image_url: string; category: ShowcaseCategory; created_at: string; updated_at: string;
  is_public: boolean; allow_replies: boolean; like_count: number; comment_count: number; user_liked: boolean; user_saved: boolean;
  /** Uploaded media (images + videos) rendered as a carousel. */
  attachments: ShowcaseAttachment[];
  author: { name: string; avatar_url: string | null };
}

export interface ShowcaseComment {
  id: string; post_id: string; user_id: string; parent_id: string | null; body: string; created_at: string; updated_at: string;
  users: { name: string; avatar_url: string | null } | null;
  replies: ShowcaseComment[];
}