-- ============================================================
-- Complete moderation system
--
-- Extends the existing `interaction_reports` queue (comments, chat
-- messages, profiles) with communities and job listings instead of
-- creating a second reporting table. Adds:
--
--   • interaction_reports  — two more target types, the six new reason
--                            ids the community/job reason lists need, an
--                            `actioned` resolution state for account
--                            actions that leave content in place, and a
--                            structured evidence snapshot.
--   • moderation_audit_log — append-only record of every moderator
--                            decision, including previous/new state.
--   • moderation_appeals   — one appeal per report, reviewed by an
--                            administrator.
--   • users.suspended_until — temporary suspension; `is_blocked` stays
--                            the permanent ban.
--   • job_posts.moderated_at / moderation_note — a moderated posting is
--                            closed (never deleted), so applications
--                            survive; a trigger stops its owner
--                            reopening it.
--
-- Snapshot rule: every report keeps its own copy of what was reported.
-- Deleting the community or posting later never removes the evidence.
-- ============================================================

-- ─── 1. Report target types and reasons ─────────────────────

alter table public.interaction_reports
  drop constraint if exists interaction_reports_target_type_check;

alter table public.interaction_reports
  add constraint interaction_reports_target_type_check check (
    target_type in (
      'thread_comment',
      'showcase_comment',
      'resource_comment',
      'event_comment',
      'community_message',
      'profile',
      'community',
      'job'
    )
  );

-- The union of every reason list. Which subset applies to which target is
-- enforced in the application (`apps/web/lib/communities/report-reasons.ts`), so a
-- client can never post a reason outside the set it was offered.
alter table public.interaction_reports
  drop constraint if exists interaction_reports_reason_check;

alter table public.interaction_reports
  add constraint interaction_reports_reason_check check (
    reason in (
      -- Existing interaction reasons.
      'spam',
      'harassment',
      'hate',
      'misinformation',
      'inappropriate',
      'intellectual_property',
      'off_topic',
      'other',
      -- Community / job reasons added here.
      'impersonation',
      'illegal',
      'scam',
      'discriminatory',
      'payment_request',
      'expired'
    )
  );

-- `actioned` covers a warning, suspension or ban: the report is upheld and
-- the account was acted on, but the content itself was not deleted.
alter table public.interaction_reports
  drop constraint if exists interaction_reports_status_check;

alter table public.interaction_reports
  add constraint interaction_reports_status_check check (
    status in ('pending', 'removed', 'actioned', 'dismissed')
  );

-- The structured evidence a community/job report keeps: name, description,
-- owner/poster, company and the lifecycle state at report time. The flat
-- columns above stay the queue's primary read; this preserves the detail.
alter table public.interaction_reports
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb;

alter table public.interaction_reports
  add column if not exists resolution_note text;

create index if not exists idx_interaction_reports_reason_created
  on public.interaction_reports (reason, created_at desc);

create index if not exists idx_interaction_reports_type_status_created
  on public.interaction_reports (target_type, status, created_at desc);

-- ─── 2. Moderation audit log ────────────────────────────────
-- Append-only by construction: RLS is enabled with no policies, anon and
-- authenticated hold no privileges, service_role may only select/insert, and
-- a trigger rejects UPDATE/DELETE from every role (including service_role).

create table if not exists public.moderation_audit_log (
  id              uuid primary key default gen_random_uuid(),
  -- Admin sessions have no users row (ADMIN_PASSWORD login), so this is
  -- nullable; `moderator_sid` names the admin session that acted.
  moderator_id    uuid references public.users (id) on delete set null,
  moderator_sid   text,
  action          text not null check (
    action in (
      'dismiss_report',
      'remove_content',
      'hide_community',
      'deactivate_job',
      'warn_user',
      'suspend_user',
      'ban_user',
      'unban_user',
      'lift_suspension',
      'grant_appeal',
      'deny_appeal'
    )
  ),
  target_type     text not null,
  target_id       uuid,
  report_id       uuid references public.interaction_reports (id) on delete set null,
  -- The account a warning/restriction applied to, when different from the
  -- target's author (they are the same for every current action).
  subject_user_id uuid references public.users (id) on delete set null,
  previous_state  jsonb not null default '{}'::jsonb,
  new_state       jsonb not null default '{}'::jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_moderation_audit_created
  on public.moderation_audit_log (created_at desc);

create index if not exists idx_moderation_audit_target
  on public.moderation_audit_log (target_type, target_id, created_at desc);

create index if not exists idx_moderation_audit_report
  on public.moderation_audit_log (report_id);

create or replace function public.moderation_audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'moderation_audit_log is append-only';
end;
$$;

drop trigger if exists trg_moderation_audit_log_immutable on public.moderation_audit_log;
create trigger trg_moderation_audit_log_immutable
  before update or delete on public.moderation_audit_log
  for each row execute function public.moderation_audit_log_immutable();

alter table public.moderation_audit_log enable row level security;
revoke all on public.moderation_audit_log from anon, authenticated;
grant select, insert on public.moderation_audit_log to service_role;

-- ─── 3. Appeals ─────────────────────────────────────────────
-- One appeal per report, ever: the unique index is the abuse guard, and the
-- API adds a daily per-member limit on top.

create table if not exists public.moderation_appeals (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.interaction_reports (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  target_type     text not null,
  target_id       uuid not null,
  message         text not null check (char_length(btrim(message)) between 20 and 2000),
  status          text not null default 'pending' check (
    status in ('pending', 'granted', 'denied')
  ),
  resolution_note text,
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists moderation_appeals_report_unique
  on public.moderation_appeals (report_id);

create index if not exists idx_moderation_appeals_status_created
  on public.moderation_appeals (status, created_at desc);

create index if not exists idx_moderation_appeals_user_created
  on public.moderation_appeals (user_id, created_at desc);

alter table public.moderation_appeals enable row level security;
revoke all on public.moderation_appeals from anon, authenticated;
grant select, insert, update on public.moderation_appeals to service_role;

-- ─── 4. Temporary suspension ────────────────────────────────
-- `is_blocked` remains the permanent ban (it already revokes sessions).
-- A future `suspended_until` makes the account inactive until that instant;
-- the session validator reads it, so a suspended member is signed out like a
-- blocked one, and the account becomes usable again without a moderator
-- having to come back.

alter table public.users
  add column if not exists suspended_until timestamptz;

create index if not exists idx_users_suspended_until
  on public.users (suspended_until)
  where suspended_until is not null;

-- Mirrors set_user_blocked: writes the deadline, bumps the session version
-- and revokes every live session in one statement. `p_until = null` lifts a
-- suspension (used when an appeal is granted).
create or replace function public.set_user_suspended(
  p_user_id uuid,
  p_until timestamptz,
  p_reason text
)
returns table (id uuid, suspended_until timestamptz, session_version integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users as u
     set suspended_until = p_until,
         session_version = u.session_version + 1,
         updated_at = now()
   where u.id = p_user_id
  returning u.id, u.suspended_until, u.session_version
       into id, suspended_until, session_version;

  if not found then
    raise exception 'account_unavailable' using errcode = 'P0001';
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and revoked_at is null;

  return next;
end;
$$;

comment on function public.set_user_suspended(uuid, timestamptz, text) is
  'Applies or lifts a temporary suspension, bumps the session version and revokes every live session.';

revoke all on function public.set_user_suspended(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.set_user_suspended(uuid, timestamptz, text) to service_role;

-- ─── 5. Job moderation state ────────────────────────────────
-- A moderated posting is CLOSED, never deleted: `job_applications` and the
-- applicant resumes stay exactly where they were. `moderated_at` is what
-- distinguishes a moderation takedown from the owner's own Close, so the
-- owner cannot simply reopen it.

alter table public.job_posts
  add column if not exists moderated_at timestamptz;

alter table public.job_posts
  add column if not exists moderation_note text;

create or replace function public.job_posts_guard_moderated_reopen()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed'
     and new.status = 'open'
     and old.moderated_at is not null
     and new.moderated_at is not null then
    raise exception 'job_moderated';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_posts_guard_moderated_reopen on public.job_posts;
create trigger trg_job_posts_guard_moderated_reopen
  before update on public.job_posts
  for each row execute function public.job_posts_guard_moderated_reopen();

create index if not exists idx_job_posts_moderated
  on public.job_posts (moderated_at desc)
  where moderated_at is not null;

-- ─── 6. Queue view ──────────────────────────────────────────
-- Rebuilt (rather than replaced) to carry the new snapshot and resolver
-- columns. Grants are re-applied after the drop.

drop view if exists public.interaction_report_queue;

create view public.interaction_report_queue as
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
  r.created_at,
  r.resolved_by,
  r.target_snapshot,
  r.resolution_note
from public.interaction_reports r
left join public.users reporter on reporter.id = r.reporter_id
left join public.users author on author.id = r.target_author_id
left join public.communities community on community.id = r.community_id;

revoke all on public.interaction_report_queue from anon, authenticated;
grant select on public.interaction_report_queue to service_role;

-- ─── 7. Notification vocabulary ─────────────────────────────
-- `moderation_action` tells the affected member what happened and why;
-- `appeal_reviewed` closes the appeal loop. Both use the new 'moderation'
-- entity type keyed by the report id, so neither can collapse into another
-- unread notification for the same community/job.

alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in (
      'community', 'thread', 'resource', 'event', 'message', 'showcase', 'job',
      'verification', 'profile',
      -- One moderation notice per report, keyed by the report id, so it can
      -- never aggregate into an unrelated unread notification on the target.
      'moderation'
    )
  );

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
      'content_restored',
      'job_match',
      'join_request_accepted',
      'event_reminder',
      'event_live',
      'event_ended',
      'verification_approved',
      'verification_rejected',
      'verification_reapply_ready',
      'moderation_action',
      'appeal_reviewed'
    )
  );

notify pgrst, 'reload schema';
