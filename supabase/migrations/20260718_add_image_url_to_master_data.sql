-- ============================================================
-- Migration: Add image_url column to companies, cities, design_sectors
--            and create Supabase Storage bucket for master-data images.
-- ============================================================

-- ─── image_url columns ──────────────────────────────────────
alter table companies      add column if not exists image_url text;
alter table cities         add column if not exists image_url text;
alter table design_sectors add column if not exists image_url text;

-- ─── Storage bucket ─────────────────────────────────────────
-- Creates a public bucket so uploaded images are accessible via a
-- stable public URL without requiring auth on the CDN URL.
insert into storage.buckets (id, name, public)
values ('master-data-images', 'master-data-images', true)
on conflict (id) do nothing;

-- Allow the service role (used by Next.js API routes) to read/write
-- objects in the bucket. RLS is enabled on storage.objects by default;
-- service-role bypasses it, so no extra policy needed for server uploads.
-- Public reads are handled by the bucket's `public = true` flag above.
