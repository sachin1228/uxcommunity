-- ============================================================
-- Add image_url to community_messages
-- Allows members to send compressed images in chat.
-- content is made nullable so an image-only message is valid.
-- ============================================================

alter table community_messages
  add column if not exists image_url text;

-- Allow content to be null when an image is attached
alter table community_messages
  alter column content drop not null;

-- Drop the old text-only check and replace with one that allows either
-- a non-empty content OR an image_url (or both)
alter table community_messages
  drop constraint if exists community_messages_content_check;

alter table community_messages
  add constraint community_messages_content_check check (
    (content is not null and length(content) between 1 and 2000)
    or image_url is not null
  );
