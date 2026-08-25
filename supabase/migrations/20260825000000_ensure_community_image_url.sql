-- Ensure community photos have a nullable URL column.
-- Idempotent: safe to run when image_url already exists.

alter table public.communities
  add column if not exists image_url text;

comment on column public.communities.image_url is
  'Public URL of the community photo stored in Cloudflare R2.';
