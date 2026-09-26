-- ============================================================
-- Chat notification preferences
--
-- Two problems this solves:
--
-- 1. A very active community could buzz a member's phone dozens of
--    times a minute. `push_throttle` records how many *audible*
--    pushes a member has received per community inside a rolling
--    window; the sender falls back to silent updates after the cap,
--    so the notification stays current without the buzzing.
--
-- 2. Members had no way to say "not this community" or "not at
--    night". Preferences are per-user (sound, quiet hours, master
--    switch) and per-membership (mute one community), which is
--    where the two decisions naturally live.
--
-- Read/written through the API routes with the service-role client
-- for the sender path, and with the member's own session for the
-- settings screen, so RLS is enabled with owner-only policies on
-- the preferences table. `community_members` already has its own
-- policies; the new column rides along.
-- ============================================================

-- ------------------------------------------------------------
-- Per-user notification preferences
-- ------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id            uuid primary key references public.users(id) on delete cascade,
  -- Master switch. Off means no chat push at all, badge included.
  chat_push_enabled  boolean not null default true,
  -- 'default' plays the system tone, 'silent' posts without sound.
  -- Stored per user rather than per device so the choice follows them.
  chat_sound         text not null default 'default'
    check (chat_sound in ('default', 'silent')),
  -- Quiet hours are evaluated in the member's own timezone, which the
  -- device reports on save (quiet hours that follow UTC would fire at
  -- the wrong hour for everyone outside it).
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start   time not null default '22:00',
  quiet_hours_end     time not null default '07:00',
  quiet_hours_timezone text not null default 'UTC',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;

-- Owner-only in both directions: a member's notification settings are
-- nobody else's business, and only they may change them.
drop policy if exists "Members can read own notification preferences"
  on public.notification_preferences;
create policy "Members can read own notification preferences"
  on public.notification_preferences for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members can insert own notification preferences"
  on public.notification_preferences;
create policy "Members can insert own notification preferences"
  on public.notification_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members can update own notification preferences"
  on public.notification_preferences;
create policy "Members can update own notification preferences"
  on public.notification_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- Per-community mute
--
-- Lives on the membership row because that is the only place that
-- knows "this member, that community" — and because the sender
-- already reads the membership rows to find recipients, so the mute
-- filter costs no extra query.
-- ------------------------------------------------------------
alter table public.community_members
  add column if not exists notifications_muted boolean not null default false;

-- ------------------------------------------------------------
-- Audible-push throttle
--
-- One row per (member, community) inside the current window. The
-- sender upserts: a stale window_started_at resets the counter to 1,
-- a fresh one increments it. Only rows with a live window matter, so
-- old rows are pruned opportunistically by the caller.
-- ------------------------------------------------------------
create table if not exists public.push_throttle (
  user_id           uuid not null references public.users(id) on delete cascade,
  community_id      uuid not null references public.communities(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  sent_count        integer not null default 0,
  primary key (user_id, community_id)
);

alter table public.push_throttle enable row level security;

-- Service-role only: this is sender bookkeeping, never client state.
revoke all on table public.push_throttle from anon, authenticated;

create index if not exists push_throttle_window_idx
  on public.push_throttle (window_started_at);

-- ------------------------------------------------------------
-- Unread totals for the app icon badge
--
-- Mirrors `get_sidebar_activity`'s unread definition
-- exactly (own messages excluded, everything since joined_at or
-- last_read_at, whichever is later) so the icon badge can never
-- disagree with the count the member sees in the app. Takes a list of
-- users because the push sender needs one total per recipient.
--
-- Quiet-hours and mute decisions never touch this: an unread message
-- is unread whether or not it was allowed to buzz.
-- ------------------------------------------------------------
create or replace function public.get_unread_message_totals(p_user_ids uuid[])
returns table (user_id uuid, unread integer)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.user_id, coalesce(sum(counts.unread), 0)::integer as unread
  from public.community_members cm
  left join lateral (
    select count(*)::integer as unread
    from public.community_messages m
    where m.community_id = cm.community_id
      and m.user_id <> cm.user_id
      and m.created_at > cm.joined_at
      and (cm.last_read_at is null or m.created_at > cm.last_read_at)
  ) counts on true
  where cm.user_id = any(p_user_ids)
    and cm.archived_at is null
  group by cm.user_id;
$$;

revoke all on function public.get_unread_message_totals(uuid[]) from anon, authenticated;
