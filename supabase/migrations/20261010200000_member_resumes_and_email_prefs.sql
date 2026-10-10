-- ============================================================
-- Saved resumes + email preferences
--
-- WHY
--   Two Settings needs that had no storage at all:
--
--   1. Members apply to jobs through ApplyModal, which asks for a
--      resume attachment every single time — the same PDF, picked
--      from disk again and again. This table lets a member save up
--      to three resumes up front (Settings → Job profile) and pick
--      one when they apply. The file itself lives in R2; the row
--      carries the metadata the list renders and the URL the apply
--      route copies onto the application.
--
--   2. The email toggles on Settings (job application updates,
--      community activity, product news) are per-user decisions
--      stored next to the existing chat push preferences — they are
--      read by the same settings API and answered by the same row,
--      so they ride on `notification_preferences` rather than a new
--      table. `email_job_updates` and `email_community_activity`
--      default on because they are part of the product's core loop;
--      `email_product_news` defaults off because it is marketing.
--
--   `url` is tracked in @uxcommunity/shared's ALL_MEDIA_LOOKUPS so
--   the R2 orphan audit never treats a saved resume as an orphan.
--   RLS is owner-only on both read and write: a member's saved
--   resumes are theirs alone, and the routes reach them with the
--   service-role client the same way the notification preferences
--   routes do.
--
-- Deploy note: new table + three additive columns with defaults, so
-- existing rows stay valid and no backfill is needed. Apply after
-- 20261010170000_profile_feed_saved_bookmarks.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Saved resumes (max three per member, enforced by the API and
-- the partial unique index below for the default pick)
-- ------------------------------------------------------------
create table if not exists public.member_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  url text not null,
  -- Exactly one resume per member may be the default (preselected
  -- when applying). Enforced by a partial unique index so the
  -- "make default" flow can never leave two.
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists member_resumes_user_id_idx on public.member_resumes (user_id);

create unique index if not exists member_resumes_one_default_per_user_idx
  on public.member_resumes (user_id) where is_default;

alter table public.member_resumes enable row level security;

revoke all on table public.member_resumes from anon, authenticated;
grant select, insert, update, delete on table public.member_resumes to authenticated;

-- Owner-only in both directions: a member's saved resumes are
-- nobody else's business, and only they may add, change or remove
-- them.
drop policy if exists "Members can read own resumes"
  on public.member_resumes;
create policy "Members can read own resumes"
  on public.member_resumes for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members can insert own resumes"
  on public.member_resumes;
create policy "Members can insert own resumes"
  on public.member_resumes for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can update own resumes"
  on public.member_resumes;
create policy "Members can update own resumes"
  on public.member_resumes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Members can delete own resumes"
  on public.member_resumes;
create policy "Members can delete own resumes"
  on public.member_resumes for delete
  to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Email preferences on the existing notification_preferences row
-- ------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists email_job_updates boolean not null default true,
  add column if not exists email_community_activity boolean not null default true,
  add column if not exists email_product_news boolean not null default false;
