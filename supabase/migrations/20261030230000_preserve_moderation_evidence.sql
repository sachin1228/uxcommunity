-- ============================================================
-- Preserve moderation evidence after account deletion
--
-- PROBLEM
--   `interaction_reports`, `content_reports` and `dm_reports` all pointed
--   `reporter_id` at `public.users (id)` with `on delete cascade`. Deleting a
--   reporter's account therefore deleted every report they had filed, along
--   with the evidence snapshot and any audit rows' report link. A report about
--   a community or job could disappear just because the person who noticed it
--   later erased their account.
--
-- WHAT CHANGES
--   1. `reporter_id` becomes nullable in all three queues and its foreign key
--      becomes `on delete set null`. The report row, its id, timestamps,
--      reason, details, target snapshot, status and resolution are untouched.
--   2. `reporter_deleted_at` records when the reporter's account was erased, so
--      the admin queues can say "Deleted user" rather than "Member".
--   3. A `before delete on users` trigger anonymizes every report the account
--      filed in the same transaction as the account deletion. The shared
--      deletion service (`lib/account/delete.ts`) is a single `users` delete,
--      so self-service erasure and admin erasure both run this trigger. The
--      FK's `on delete set null` is the second line of defence if the trigger
--      is ever disabled (for example during a restore).
--   4. Audit attribution gets a `moderator_label` snapshot. The historical
--      `moderator_id` and `subject_user_id` columns stop being foreign keys:
--      their `on delete set null` actions were themselves UPDATEs, which the
--      append-only trigger rejects, so deleting a previously-moderated account
--      would fail. Keeping the raw historical ids plus the label makes the
--      decision attributable without ever rewriting the audit row.
--      `moderator_sid` continues to name the acting admin session. For the
--      same reason, `report_id` stops being a foreign key: a retention purge
--      may one day delete old evidence, but it must never cause an UPDATE of
--      the append-only audit row.
--   5. The three queue views show "Deleted user" for an anonymized reporter.
--
-- PRIVACY
--   The report is deliberately NOT linked to a stable deleted-account id, a
--   hash of one, or a hidden profile. After the trigger runs, there is no
--   column in the report that can resolve the reporter to a person. The only
--   reporter-authored content that remains is the report's own free-text
--   `details`, which is part of the evidence and can itself contain personal
--   information. `audit/MODERATION_EVIDENCE_RETENTION.md` records that
--   trade-off and the review needed for a retention period.
--
-- SAFETY
--   Every statement is additive or loosens a constraint. No report row is
--   deleted or rewritten except for anonymizing an existing reporter reference
--   (and only when an account is actually deleted). Existing reports keep
--   their ids, timestamps, snapshots and status. Run this migration before
--   deploying the application change that treats `reporter_id` as nullable.
-- ============================================================

-- ─── 1. Reporter references become nullable and non-cascading ───

alter table public.interaction_reports
  add column if not exists reporter_deleted_at timestamptz;

alter table public.content_reports
  add column if not exists reporter_deleted_at timestamptz;

alter table public.dm_reports
  add column if not exists reporter_deleted_at timestamptz;

alter table public.interaction_reports
  alter column reporter_id drop not null;
alter table public.content_reports
  alter column reporter_id drop not null;
alter table public.dm_reports
  alter column reporter_id drop not null;

alter table public.interaction_reports
  drop constraint if exists interaction_reports_reporter_id_fkey;
alter table public.content_reports
  drop constraint if exists content_reports_reporter_id_fkey;
alter table public.dm_reports
  drop constraint if exists dm_reports_reporter_id_fkey;

-- The old foreign key guaranteed there were no orphans. This guard runs
-- before the replacement FK is validated, so a database repaired outside the
-- migration chain is anonymized rather than left pointing at a missing
-- account (which would make the new constraint fail).
update public.interaction_reports r
   set reporter_id = null,
       reporter_deleted_at = coalesce(r.reporter_deleted_at, now())
 where r.reporter_id is not null
   and not exists (select 1 from public.users u where u.id = r.reporter_id);

update public.content_reports r
   set reporter_id = null,
       reporter_deleted_at = coalesce(r.reporter_deleted_at, now())
 where r.reporter_id is not null
   and not exists (select 1 from public.users u where u.id = r.reporter_id);

update public.dm_reports r
   set reporter_id = null,
       reporter_deleted_at = coalesce(r.reporter_deleted_at, now())
 where r.reporter_id is not null
   and not exists (select 1 from public.users u where u.id = r.reporter_id);

alter table public.interaction_reports
  add constraint interaction_reports_reporter_id_fkey
  foreign key (reporter_id) references public.users (id) on delete set null;

alter table public.content_reports
  add constraint content_reports_reporter_id_fkey
  foreign key (reporter_id) references public.users (id) on delete set null;

alter table public.dm_reports
  add constraint dm_reports_reporter_id_fkey
  foreign key (reporter_id) references public.users (id) on delete set null;

comment on column public.interaction_reports.reporter_deleted_at is
  'When the reporter account was erased. reporter_id is null from then on; the report is retained as evidence.';
comment on column public.content_reports.reporter_deleted_at is
  'When the reporter account was erased. reporter_id is null from then on; the report is retained as evidence.';
comment on column public.dm_reports.reporter_deleted_at is
  'When the reporter account was erased. reporter_id is null from then on; the report is retained as evidence.';

-- ─── 2. Anonymize in the account-deletion transaction ───────
-- Owned communities are handled by another `before delete` trigger. This one
-- is named to sort first, so reports are anonymized even when the account's
-- communities are about to be transferred or deleted. `security definer`
-- keeps the update working if a future deletion path runs under a role that
-- cannot write the report tables directly.

create or replace function public.anonymize_deleted_user_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.interaction_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.content_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.dm_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  return old;
end;
$$;

comment on function public.anonymize_deleted_user_reports() is
  'Before a user row is deleted, removes the account link from every report they filed while retaining the report and its evidence.';

drop trigger if exists trg_anonymize_deleted_user_reports on public.users;
create trigger trg_anonymize_deleted_user_reports
  before delete on public.users
  for each row execute function public.anonymize_deleted_user_reports();

revoke all on function public.anonymize_deleted_user_reports() from public, anon, authenticated;
grant execute on function public.anonymize_deleted_user_reports() to service_role;

-- ─── 3. Audit attribution survives moderator deletion ──────
-- The audit table is append-only: its `before update` trigger rejects every
-- update. That collided with its `on delete set null` user references — the
-- foreign-key action is an UPDATE, so deleting any member named as a
-- moderator or subject would abort the whole account deletion. The references
-- are historical facts, so they become plain UUID columns: the audit row is
-- never rewritten by a later account deletion, and the id plus the captured
-- label keep the decision attributable.
--
-- All three references become historical UUIDs. `report_id` is included:
-- reports are retained now, but an eventual retention purge must be able to
-- remove old evidence without the audit table trying to null its link and
-- tripping the append-only trigger.

alter table public.moderation_audit_log
  drop constraint if exists moderation_audit_log_moderator_id_fkey;
alter table public.moderation_audit_log
  drop constraint if exists moderation_audit_log_subject_user_id_fkey;
alter table public.moderation_audit_log
  drop constraint if exists moderation_audit_log_report_id_fkey;

alter table public.moderation_audit_log
  add column if not exists moderator_label text;

comment on column public.moderation_audit_log.moderator_id is
  'Historical moderator account id at action time. Deliberately not a foreign key: audit rows are append-only and must never be rewritten by account deletion.';
comment on column public.moderation_audit_log.subject_user_id is
  'Historical affected-account id at action time. Deliberately not a foreign key: audit rows are append-only and must never be rewritten by account deletion.';
comment on column public.moderation_audit_log.report_id is
  'Historical report id at action time. Deliberately not a foreign key: audit rows are append-only and must never be rewritten by an evidence-retention purge.';
comment on column public.moderation_audit_log.moderator_label is
  'Moderator display name captured when the action was taken, so attribution survives deletion of the moderator account.';

-- ─── 4. Queue views show Deleted user, never a dangling identity ───

drop view if exists public.interaction_report_queue;

create view public.interaction_report_queue as
select
  r.id,
  r.reporter_id,
  case
    when r.reporter_id is null then 'Deleted user'
    else coalesce(reporter.name, 'Member')
  end as reporter_name,
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
  r.created_at,
  r.resolved_by,
  r.target_snapshot,
  r.resolution_note,
  r.reporter_deleted_at
from public.interaction_reports r
left join public.users reporter on reporter.id = r.reporter_id
left join public.users author on author.id = r.target_author_id
left join public.communities community on community.id = r.community_id;

revoke all on public.interaction_report_queue from anon, authenticated;
grant select on public.interaction_report_queue to service_role;

drop view if exists public.dm_report_queue;

create view public.dm_report_queue as
select
  r.id,
  r.reporter_id,
  case
    when r.reporter_id is null then 'Deleted user'
    else coalesce(reporter.name, 'Member')
  end as reporter_name,
  r.reported_user_id,
  reported.name as reported_user_name,
  r.conversation_id,
  r.reason,
  r.details,
  r.message_snapshot,
  r.status,
  r.resolved_at,
  r.created_at,
  r.reporter_deleted_at
from public.dm_reports r
left join public.users reporter on reporter.id = r.reporter_id
left join public.users reported on reported.id = r.reported_user_id;

revoke all on public.dm_report_queue from anon, authenticated;
grant select on public.dm_report_queue to service_role;

-- `report_groups` keeps its shape. Only the reporter-name aggregate changes:
-- an anonymized reporter appears as "Deleted user" instead of making the whole
-- name list look empty for the post.
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
  select array_agg(distinct
    case
      when r2.reporter_id is null then 'Deleted user'
      else coalesce(ru.name, 'Member')
    end
  ) as names
  from public.content_reports r2
  left join public.users ru on ru.id = r2.reporter_id
  where r2.content_type = g.content_type
    and r2.content_id = g.content_id
) rn on true;

revoke all on public.report_groups from anon, authenticated;
grant select on public.report_groups to service_role;

notify pgrst, 'reload schema';
