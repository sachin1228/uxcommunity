-- ============================================================
-- Drop the moderation service schema. `moderation_events` and its
-- two enums only existed for the image/text moderation layer
-- (apps/web/lib/moderation), which has been removed — content
-- routes now do their own validation with no review queue.
-- ============================================================

drop table if exists public.moderation_events;

drop type if exists public.moderation_content_type;
drop type if exists public.moderation_status;
