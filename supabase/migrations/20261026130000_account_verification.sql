-- ============================================================
-- Account verification: read-only accounts until an admin approves
--
-- New signups are created read-only. They can browse, read their
-- default communities, and like posts, but every other write is
-- blocked server-side until an admin approves their verification.
--
-- Existing accounts are grandfathered as approved: the column is
-- added with `default 'approved'`, which backfills every current row,
-- and only then is the default flipped to 'unverified' for new rows.
-- Re-running the file does not re-approve anyone.
--
-- The app never uses an authenticated Supabase client (all API writes
-- go through the service role and the signed session JWT), so these
-- tables are service-role-only: RLS is enabled with no policies.
-- ============================================================

alter table public.users
  add column if not exists verification_status text not null default 'approved'
    check (verification_status in ('unverified', 'pending', 'approved', 'rejected')),
  add column if not exists verification_rejection_reason text,
  add column if not exists verification_reapply_at timestamptz,
  add column if not exists verification_reviewed_at timestamptz,
  add column if not exists verification_notified_at timestamptz,
  add column if not exists email_verified_at timestamptz;

-- New rows only, after the backfill above.
alter table public.users alter column verification_status set default 'unverified';

create index if not exists idx_users_verification_status
  on public.users (verification_status);

comment on column public.users.verification_status is
  'unverified | pending | approved | rejected. Only approved accounts may write.';
comment on column public.users.email_verified_at is
  'Set when the member confirms the OTP sent to their account email.';
comment on column public.users.verification_reapply_at is
  'Rejected members may submit a new request at this time (one month after review).';
comment on column public.users.verification_notified_at is
  'When the reapply-eligible email was sent, so the cron never sends it twice.';

create table if not exists public.account_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  linkedin_url text not null,
  portfolio_links text[] not null,
  work_sample_urls text[] not null default '{}',
  email_verified_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_verification_requests_portfolio_len
    check (cardinality(portfolio_links) between 1 and 2),
  constraint account_verification_requests_samples_len
    check (cardinality(work_sample_urls) <= 3)
);

create index if not exists idx_account_verification_requests_user
  on public.account_verification_requests (user_id, created_at desc);
create index if not exists idx_account_verification_requests_status
  on public.account_verification_requests (status, created_at desc);

-- One open review per member; history still keeps every past decision.
create unique index if not exists uq_account_verification_requests_pending
  on public.account_verification_requests (user_id)
  where status = 'pending';

alter table public.account_verification_requests enable row level security;

comment on table public.account_verification_requests is
  'Verification submissions and their review history. Service-role only.';

create table if not exists public.verification_email_codes (
  user_id uuid primary key references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.verification_email_codes enable row level security;

comment on table public.verification_email_codes is
  'Hashed one-time codes for the account-email check. Service-role only.';

-- One atomic review: the request row, the member's state and the reapply
-- clock move together, so a failed second write cannot leave a member
-- rejected while the request still reads pending (or vice versa).
create or replace function public.review_account_verification(
  p_request_id uuid,
  p_action text,
  p_reason text,
  p_reviewed_by text
)
returns table (
  user_id uuid,
  verification_status text,
  reapply_at timestamptz,
  user_name text,
  user_email text,
  rejection_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_user_email text;
  v_reason text;
  v_reapply_at timestamptz;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;

  select r.user_id, u.name, u.email
    into v_user_id, v_user_name, v_user_email
    from public.account_verification_requests r
    join public.users u on u.id = r.user_id
   where r.id = p_request_id
     and r.status = 'pending'
   for update of r;

  if v_user_id is null then
    raise exception 'request_not_pending';
  end if;

  if p_action = 'approve' then
    update public.account_verification_requests
       set status = 'approved',
           rejection_reason = null,
           reviewed_by = p_reviewed_by,
           reviewed_at = now(),
           updated_at = now()
     where id = p_request_id;

    update public.users
       set verification_status = 'approved',
           verification_rejection_reason = null,
           verification_reapply_at = null,
           verification_reviewed_at = now(),
           verification_notified_at = null
     where id = v_user_id;
  else
    v_reason := nullif(trim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'reason_required';
    end if;

    v_reapply_at := now() + interval '1 month';

    update public.account_verification_requests
       set status = 'rejected',
           rejection_reason = v_reason,
           reviewed_by = p_reviewed_by,
           reviewed_at = now(),
           updated_at = now()
     where id = p_request_id;

    update public.users
       set verification_status = 'rejected',
           verification_rejection_reason = v_reason,
           verification_reapply_at = v_reapply_at,
           verification_reviewed_at = now(),
           verification_notified_at = null
     where id = v_user_id;
  end if;

  return query
    select u.id, u.verification_status, u.verification_reapply_at,
           v_user_name, v_user_email, u.verification_rejection_reason
      from public.users u
     where u.id = v_user_id;
end;
$$;

revoke all on function public.review_account_verification(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.review_account_verification(uuid, text, text, text) to service_role;

-- The review notices are new notification types/entities. The constraints
-- grew with every feature that added one; extend them here so the approval and
-- rejection rows (and the reapply reminder) can be inserted.
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
      'verification_reapply_ready'
    )
  );

alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in (
      'community', 'thread', 'resource', 'event', 'message', 'showcase', 'job', 'verification'
    )
  );
