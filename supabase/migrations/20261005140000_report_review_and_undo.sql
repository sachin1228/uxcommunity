-- ============================================================
-- Report review: grouped queue, undoable removals
--
-- Three pieces the admin dashboard needs on top of 20261005120000:
--
--   1. `content_removals` — before a platform admin removes reported content,
--      the row plus its discussion (comments, reactions, likes/saves/RSVPs/
--      poll votes) is snapshotted here. "Undo" re-inserts everything with the
--      same ids and marks the record undone. The R2 objects are deliberately
--      NOT reclaimed on removal, so media still resolves after a restore; an
--      orphaned object that is never restored is reaped by the R2 orphan audit
--      after its grace period.
--
--   2. `report_groups` — the queue, one row per reported post instead of one
--      per report (a thread can be reported by many members). PostgREST can
--      filter, search, sort (most reported first) and paginate it directly.
--      `status` is the content's review state: any pending report wins, then
--      removed, else dismissed.
--
--   3. `content_restored` — the author's "your post is back" notification.
-- ============================================================

-- ─── 1. Undo snapshots ──────────────────────────────────────────────────────
create table if not exists public.content_removals (
  id                uuid primary key default gen_random_uuid(),
  content_type      text not null check (
    content_type in ('thread', 'showcase', 'resource', 'event')
  ),
  content_id        uuid not null,
  community_id      uuid references public.communities (id) on delete set null,
  content_author_id uuid references public.users (id) on delete set null,
  content_title     text,
  -- { version, content: <full row>, children: { <table>: <rows[]> }, event_chat_community_id }
  snapshot          jsonb not null,
  removed_by        uuid references public.users (id) on delete set null,
  removed_at        timestamptz not null default now(),
  undone_at         timestamptz,
  undone_by         uuid references public.users (id) on delete set null
);

create index if not exists idx_content_removals_content
  on public.content_removals (content_type, content_id, removed_at desc);

-- The queue only needs "is there an un-undone removal for this post".
create index if not exists idx_content_removals_active
  on public.content_removals (content_type, content_id)
  where undone_at is null;

alter table public.content_removals enable row level security;

-- ─── 2. The grouped queue ───────────────────────────────────────────────────
-- One row per reported post. The live content table wins over the report
-- snapshot for title/author/community so an edited title reads current; a
-- deleted post falls back to the snapshot.
create or replace view public.report_groups as
with grouped as (
  select
    r.content_type,
    r.content_id,
    (array_agg(distinct r.community_id))[1]           as community_id,
    (array_agg(distinct r.content_author_id))[1]      as content_author_id,
    (array_agg(distinct r.content_title))[1]          as content_title,
    count(*)::int                                     as report_count,
    count(*) filter (where r.status = 'pending')::int as pending_count,
    min(r.created_at)                                 as first_reported_at,
    max(r.created_at)                                 as last_reported_at,
    array_agg(distinct r.reason)                      as reasons,
    array_agg(distinct r.reporter_id)                 as reporter_ids,
    case
      when count(*) filter (where r.status = 'pending') > 0 then 'pending'
      when count(*) filter (where r.status = 'removed') > 0 then 'removed'
      else 'dismissed'
    end                                               as status
  from public.content_reports r
  group by r.content_type, r.content_id
),
live as (
  select 'thread'::text as content_type, t.id as content_id, t.title, t.user_id, t.community_id
    from public.community_threads t
  union all
  select 'showcase', p.id, p.title, p.user_id, p.community_id
    from public.community_showcase_posts p
  union all
  select 'resource', r.id, r.title, r.user_id, r.community_id
    from public.community_resources r
  union all
  select 'event', e.id, e.title, e.user_id, e.community_id
    from public.community_events e
)
select
  g.content_type,
  g.content_id,
  coalesce(l.community_id, g.community_id)          as community_id,
  coalesce(l.user_id, g.content_author_id)          as content_author_id,
  coalesce(l.title, g.content_title)                as content_title,
  g.report_count,
  g.pending_count,
  g.status,
  g.reasons,
  g.reporter_ids,
  g.first_reported_at,
  g.last_reported_at,
  (l.content_id is not null)                        as content_exists,
  u.name                                            as author_name,
  c.name                                            as community_name,
  rn.names                                          as reporter_names,
  exists (
    select 1
    from public.content_removals cr
    where cr.content_type = g.content_type
      and cr.content_id = g.content_id
      and cr.undone_at is null
  )                                                 as can_restore
from grouped g
left join live l
  on l.content_type = g.content_type and l.content_id = g.content_id
left join public.users u
  on u.id = coalesce(l.user_id, g.content_author_id)
left join public.communities c
  on c.id = coalesce(l.community_id, g.community_id)
left join lateral (
  select array_agg(distinct ru.name) as names
  from public.content_reports r2
  join public.users ru on ru.id = r2.reporter_id
  where r2.content_type = g.content_type
    and r2.content_id = g.content_id
) rn on true;

-- Supabase grants new public-schema relations to anon/authenticated by
-- default; the queue is service-role only.
revoke all on public.report_groups from anon, authenticated;
grant select on public.report_groups to service_role;

-- ─── 3. The author's restore notification ───────────────────────────────────
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'thread_comment',
      'thread_reply',
      'thread_like',
      'resource_comment',
      'resource_reply',
      'event_comment',
      'event_reply',
      'event_rsvp',
      'thread_deleted',
      'showcase_deleted',
      'resource_deleted',
      'event_deleted',
      'report_reviewed',
      'content_restored'
    )
  );

notify pgrst, 'reload schema';
