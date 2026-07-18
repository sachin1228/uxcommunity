-- ============================================================
-- Migration: Add avatar_url + avatar_source to designer_profiles
--            and create Supabase Storage bucket for profile avatars.
-- ============================================================

-- ─── avatar columns ─────────────────────────────────────────
alter table designer_profiles
  add column if not exists avatar_url    text,
  add column if not exists avatar_source text
    check (avatar_source in ('dicebear', 'boring-avatars', 'upload', 'robohash'));

-- ─── Storage bucket ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do nothing;

-- Public read access is handled by bucket public = true.
-- Server-side uploads use the service role which bypasses RLS.
