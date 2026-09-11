-- ============================================================
-- Drop video_media — removes the centralized video-processing
-- lifecycle table. Videos are plain file uploads again (stored
-- directly by the showcase upload route); no encoding, no queue,
-- no transcoder.
-- ============================================================

drop table if exists public.video_media;
