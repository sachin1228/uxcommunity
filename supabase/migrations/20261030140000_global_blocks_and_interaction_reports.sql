-- ============================================================
-- Global blocking + interaction reports
--
-- 1. BLOCKING IS NO LONGER DM-ONLY
--    `dm_blocks` is renamed to `user_blocks`; the rows, constraints and
--    indexes are preserved, so every existing block keeps working. A read-only
--    `dm_blocks` view remains for the DM SQL functions and RPCs that reference
--    the old name, so their bodies do not need to change.
--
--    Application code now treats a block as a member-to-member boundary:
--    DMs, comments/replies, chat replies, and any notification the blocked
--    member would otherwise trigger are refused or suppressed.
--
-- 2. INTERACTION REPORTS
--    Comments, community chat messages and profiles can now be reported into
--    their own queue. Post-level reports keep using `content_reports` and the
--    existing removal/restore machinery; interaction reports are deliberately a
--    separate table because their removal semantics and snapshots differ.
-- ============================================================

-- ─── 1. Blocks ──────────────────────────────────────────────
alter table public.dm_blocks rename to user_blocks;

alter table public.user_blocks
  rename constraint dm_blocks_no_self to user_blocks_no_self;
alter table public.user_blocks
  rename constraint dm_blocks_pair_unique to user_blocks_pair_unique;

alter index public.idx_dm_blocks_blocked rename to idx_user_blocks_blocked;

comment on table public.user_blocks is
  'Member-to-member blocks (formerly dm_blocks). One row per (blocker, blocked) pair; enforced on DMs, comments, chat replies and notifications.';

-- Compatibility view for the DM trigger and DM RPCs, which still read
-- public.dm_blocks. Read-only: all writes go to public.user_blocks.
create or replace view public.dm_blocks as
select id, blocker_id, blocked_id, created_at
  from public.user_blocks;

revoke all on public.dm_blocks from anon, authenticated;
grant select on public.dm_blocks to service_role;
grant select, insert, delete on public.user_blocks to service_role;

-- ─── 2. Interaction reports ─────────────────────────────────
create table if not exists public.interaction_reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid not null references public.users (id) on delete cascade,
  target_type        text not null check (
    target_type in (
      'thread_comment',
      'showcase_comment',
      'resource_comment',
      'event_comment',
      'community_message',
      'profile'
    )
  ),
  target_id          uuid not null,
  -- Parent content id (thread/showcase/resource/event post, or community for a
  -- chat message). Lets the queue link to the surrounding context.
  context_id         uuid,
  community_id       uuid references public.communities (id) on delete set null,
  target_author_id   uuid references public.users (id) on delete set null,
  -- Snapshots so the queue still reads after the target is edited or deleted.
  target_author_name text,
  target_excerpt     text,
  context_title      text,
  reason             text not null check (
    reason in (
      'spam',
      'harassment',
      'hate',
      'misinformation',
      'inappropriate',
      'intellectual_property',
      'off_topic',
      'other'
    )
  ),
  details            text,
  status             text not null default 'pending' check (
    status in ('pending', 'removed', 'dismissed')
  ),
  resolved_at        timestamptz,
  resolved_by        uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_interaction_reports_status_created
  on public.interaction_reports (status, created_at desc);

create index if not exists idx_interaction_reports_target
  on public.interaction_reports (target_type, target_id);

-- One open report per member per target; resolved targets can be re-reported.
create unique index if not exists interaction_reports_pending_unique
  on public.interaction_reports (reporter_id, target_type, target_id)
  where status = 'pending';

alter table public.interaction_reports enable row level security;
revoke all on public.interaction_reports from anon, authenticated;
grant select, insert, update on public.interaction_reports to service_role;

create or replace view public.interaction_report_queue as
select
  r.id,
  r.reporter_id,
  reporter.name        as reporter_name,
  r.target_type,
  r.target_id,
  r.context_id,
  r.community_id,
  coalesce(community.name, '') as community_name,
  r.target_author_id,
  coalesce(author.name, r.target_author_name) as target_author_name,
  r.target_excerpt,
  r.context_title,
  r.reason,
  r.details,
  r.status,
  r.resolved_at,
  r.created_at
from public.interaction_reports r
left join public.users reporter on reporter.id = r.reporter_id
left join public.users author on author.id = r.target_author_id
left join public.communities community on community.id = r.community_id;

revoke all on public.interaction_report_queue from anon, authenticated;
grant select on public.interaction_report_queue to service_role;

-- Reporter notifications use the existing report_reviewed type; profiles need
-- one more entity value so the row is scoped correctly.
alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in (
      'community', 'thread', 'resource', 'event', 'message', 'showcase', 'job', 'profile'
    )
  );

notify pgrst, 'reload schema';
