/**
 * Shared showcase post validation — used by the create (POST) and update
 * (PATCH) routes so both accept exactly the same rich body shape:
 * title, attachments (images + videos), stage, category, visibility and
 * reply toggles.
 */

export const SHOWCASE_CATEGORIES_SET = new Set(["ui_ux", "branding", "illustration", "motion", "product", "other"]);
export const SHOWCASE_STAGES_SET = new Set(["concept", "wip", "final", "case_study"]);
export const SHOWCASE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"]);
export const SHOWCASE_MEDIA_MAX = 5;

export interface ShowcaseAttachmentInput {
  name: string;
  url: string;
  type: string;
  size: number;
  /** First-frame image URL for video attachments (optional, videos only). */
  poster?: string;
  /** Centralized video-pipeline media ID (video attachments only). */
  mediaId?: string;
  /** Pipeline state — `ready` URLs are playable; processing ones show a placeholder. */
  status?: string;
  /** Encode strategy chosen for this upload (informational, videos only). */
  strategy?: string;
}

export const VIDEO_ATTACHMENT_STATUSES = new Set(["uploaded", "queued", "processing", "ready", "failed"]);
const MEDIA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ShowcasePostInput {
  title: string;
  imageUrl: string;
  attachments: ShowcaseAttachmentInput[];
  category: string;
  isPublic: boolean;
  allowReplies: boolean;
  stage: string | null;
}

export type ParseShowcaseBodyResult =
  | { ok: true; value: ShowcasePostInput }
  | { ok: false; error: string };

export function parseShowcaseBody(body: Record<string, unknown>): ParseShowcaseBodyResult {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const isPublic = body.is_public === true;
  const allowReplies = body.allow_replies !== false;

  if (!title || title.length > 2000) return { ok: false, error: "Add a title up to 2,000 characters." };
  if (!SHOWCASE_CATEGORIES_SET.has(category)) return { ok: false, error: "Invalid category." };

  // Attachments: array of { name, url, type, size } — images and videos.
  let attachments: ShowcaseAttachmentInput[] = [];
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments) || body.attachments.length > SHOWCASE_MEDIA_MAX) {
      return { ok: false, error: `You can add up to ${SHOWCASE_MEDIA_MAX} images or videos.` };
    }
    for (const item of body.attachments) {
      if (!item || typeof item !== "object") return { ok: false, error: "Invalid attachment." };
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      const type = typeof record.type === "string" ? record.type : "";
      const name = typeof record.name === "string" ? record.name.slice(0, 255) : "Attachment";
      const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0;
      if (!SHOWCASE_MEDIA_TYPES.has(type)) return { ok: false, error: "Unsupported attachment type." };

      const isVideo = type.startsWith("video/");
      const mediaId =
        isVideo && typeof record.mediaId === "string" && MEDIA_ID_RE.test(record.mediaId)
          ? record.mediaId
          : undefined;
      const status =
        isVideo && typeof record.status === "string" && VIDEO_ATTACHMENT_STATUSES.has(record.status)
          ? record.status
          : undefined;

      // Ready videos carry a real URL. Videos still in the pipeline may carry
      // an empty URL — the server resolves the canonical URL from video_media
      // at finalize; the feed renders a placeholder until then.
      if (!url || url.length > 2048) {
        const processing = isVideo && mediaId && status && status !== "ready" && url === "";
        if (!processing) return { ok: false, error: "Invalid attachment URL." };
      } else if (!/^https?:\/\//.test(url)) {
        return { ok: false, error: "Invalid attachment URL." };
      }

      // Posters ride along on video attachments (generated at upload time);
      // only accept image URLs and only on videos.
      let poster: string | undefined;
      if (isVideo && typeof record.poster === "string" && record.poster.trim()) {
        poster = record.poster.trim();
        if (!/^https?:\/\//.test(poster) || poster.length > 2048) return { ok: false, error: "Invalid attachment poster URL." };
      }
      attachments.push(
        poster || mediaId || status
          ? { name, url, type, size, poster, mediaId, status }
          : { name, url, type, size },
      );
    }
  }

  // Cover image: first uploaded image wins, then an explicit image_url, else empty.
  const firstImage = attachments.find((item) => item.type.startsWith("image/"));
  const imageUrl = firstImage?.url ?? (typeof body.image_url === "string" ? body.image_url.trim() : "");
  if (imageUrl && !/^https?:\/\//.test(imageUrl)) return { ok: false, error: "Invalid image URL." };
  if (imageUrl.length > 2048) return { ok: false, error: "Image URL is too long." };

  const stage = typeof body.stage === "string" && body.stage ? body.stage : null;
  if (stage && !SHOWCASE_STAGES_SET.has(stage)) return { ok: false, error: "Invalid stage." };

  return { ok: true, value: { title, imageUrl, attachments, category, isPublic, allowReplies, stage } };
}