-- ============================================================
-- Migration: Close unauthenticated read access to app data
--
-- WHY
-- When the app's live chat ran on Supabase Realtime, each affected table
-- was given a blanket read policy:
--
--     create policy "public_read" on <table> for select using (true);
--
-- Those policies have no `to` clause, so they apply to PUBLIC — which
-- includes `anon`, the role the Data API uses for requests carrying only
-- the publishable (anon) key. Supabase's default privileges also grant
-- `anon` and `authenticated` table access, so the two combine into an
-- unrestricted read path that bypasses the application entirely:
--
--     GET <project>/rest/v1/community_messages?select=*   (anon key)
--
-- That returns private message bodies, the community membership graph and
-- per-user notification rows to anyone who has the public key. Verified by
-- replaying schema.sql + every migration into a scratch Postgres, seeding
-- a message/membership/notification row and reading it back as `anon`.
--
-- WHY IT IS SAFE TO REMOVE
--   * Every database read/write in the app goes through the server-side
--     service-role client (apps/web/lib/supabase/service.ts), which
--     bypasses RLS. Nothing in the app queries with the anon or
--     authenticated role.
--   * The app's realtime is its own Cloudflare Durable Object service
--     (apps/realtime), not Supabase Realtime. There are no
--     postgres_changes subscriptions and no Supabase browser/server
--     client left in the repository, so none of these policies has a
--     consumer.
--   * Versions of these tables the app does serve publicly are exposed
--     through Next.js API routes, not through PostgREST.
--
-- WHAT
--   1. Drop every permissive (using (true)) SELECT policy on the tables
--      below, whatever it is named.
--   2. Revoke anon/authenticated access to those tables, so a later
--      `create policy` cannot silently re-open them — RLS stays enabled
--      and default-denies.
--   3. Enable RLS on thread_poll_votes, which was published for Realtime
--      but never had RLS turned on at all (full table exposure).
--   4. Remove the retired tables from the supabase_realtime publication.
--
-- The service role is deliberately untouched: it bypasses RLS and keeps
-- its grants, so server-side access is unchanged.
-- ============================================================

-- ─── 1 + 2. Drop permissive read policies and revoke client access ───
--
-- The loop drops policies from the catalogue instead of hardcoding names,
-- because the legacy policies are a mix of "public_read" and
-- Realtime-specific names ("event_likes_read", "thread_comment_reactions_read",
-- ...) and any of them is equivalent to full public read.
do $$
declare
  target            text;
  policy_name       text;
  private_tables    text[] := array[
    'communities',
    'community_members',
    'community_messages',
    'community_events',
    'community_join_requests',
    'community_resources',
    'community_rules',
    'community_threads',
    'content_reactions',
    'event_chat_join_responses',
    'event_comment_reactions',
    'event_comments',
    'event_likes',
    'event_rsvps',
    'event_saves',
    'experience_levels',
    'job_titles',
    'lottie_settings',
    'message_reactions',
    'notifications',
    'resource_bookmarks',
    'resource_comment_reactions',
    'resource_comments',
    'resource_saves',
    'showcase_comment_reactions',
    'thread_comment_reactions',
    'thread_comments',
    'thread_likes',
    'thread_poll_votes',
    'thread_saves'
  ];
begin
  foreach target in array private_tables loop
    if to_regclass(format('public.%I', target)) is null then
      continue;
    end if;

    -- RLS must be on so that removing the policies denies instead of opens.
    execute format('alter table public.%I enable row level security', target);

    for policy_name in
      select p.policyname
      from pg_policies as p
      where p.schemaname = 'public'
        and p.tablename = target
        and p.cmd in ('SELECT', 'ALL')
        and (p.qual is null or p.qual = 'true')
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, target);
    end loop;

    -- Belt and braces: without table privileges the Data API fails with
    -- 42501 before RLS is ever evaluated.
    execute format('revoke all on table public.%I from anon, authenticated', target);
  end loop;

  -- Residue. Every other table in `public` relies on RLS default-deny (it has
  -- RLS enabled but no policy for anon/authenticated), which is correct but
  -- fragile: one mistakenly added `using (true)` policy would expose it
  -- outright. The app never queries with either role, so drop those grants as
  -- well and let a permissive policy alone be harmless.
  --
  -- Tables created from here on get their grants from Supabase's project
  -- default privileges; the existing convention in this repo is an explicit
  -- `revoke all on table <new table> from anon, authenticated` in the
  -- migration that creates it (see 20260918120000_push_tokens.sql).
  for target in
    select c.relname
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on table public.%I from anon, authenticated', target);
  end loop;
end $$;

-- ─── 3. Retire the Supabase Realtime publication entries ────────────
--
-- These tables were added to `supabase_realtime` to feed the old
-- postgres_changes client. With no subscriber left, publishing them only
-- costs WAL. Dropping an entry is not destructive — re-adding a table is
-- a single `alter publication ... add table`.
do $$
declare
  published     text;
  realtime_tables text[] := array[
    'community_events',
    'community_messages',
    'community_resources',
    'community_rules',
    'community_showcase_posts',
    'community_threads',
    'event_comments',
    'event_likes',
    'event_saves',
    'message_reactions',
    'notifications',
    'resource_comments',
    'resource_saves',
    'showcase_comments',
    'showcase_likes',
    'showcase_saves',
    'thread_comments',
    'thread_likes',
    'thread_poll_votes'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach published in array realtime_tables loop
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = published
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', published);
    end if;
  end loop;
end $$;
