/**
 * Video upload configuration.
 *
 * Videos are plain file uploads (stored exactly as the user picked them —
 * no transcoding, no queue). This module only defines what the upload
 * surface accepts.
 */

/** Which container/MIME types we accept as uploads. */
export const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/** Upload cap for videos (matches the server-side route). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Poster (thumbnail) upload cap — one JPEG per video. */
export const MAX_POSTER_BYTES = 8 * 1024 * 1024;
