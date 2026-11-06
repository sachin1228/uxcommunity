-- Server-side ownership, finalize claim and one-time state for direct-to-R2
-- showcase videos.
--
-- The ticket route binds a media id to the member and community that requested
-- it. Finalization is a claim-based state machine in the database:
--
--   pending   -> claim_media_upload_ticket() sets a random claim token + lease
--   claimed   -> the winner HEADs the staging object, copies it to a
--                claim-specific final key and verifies the copied bytes by ETag
--   finalized -> commit_media_upload_ticket() requires the same claim token
--   rejected  -> reject_media_upload_ticket() requires the same claim token
--
-- A losing or stale claimant can never commit, and its copy lives at a
-- different claim-specific key, so it cannot overwrite the winner's object.

create table if not exists public.media_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null unique,
  user_id uuid not null references users(id) on delete cascade,
  community_id uuid not null references communities(id) on delete cascade,
  staging_key text not null unique,
  poster_staging_key text,
  content_type text not null,
  expected_size bigint not null check (expected_size > 0),
  expires_at timestamp with time zone not null,
  finalized_at timestamp with time zone,
  rejected_at timestamp with time zone,
  claim_token uuid,
  claim_started_at timestamp with time zone,
  claim_attempts integer not null default 0 check (claim_attempts >= 0),
  final_key text,
  final_poster_key text,
  final_size bigint check (final_size is null or final_size > 0),
  last_error text,
  created_at timestamp with time zone not null default now(),
  constraint media_upload_tickets_final_key_required
    check (finalized_at is null or final_key is not null)
);

create index if not exists media_upload_tickets_user_idx
  on public.media_upload_tickets (user_id, created_at desc);

create index if not exists media_upload_tickets_community_idx
  on public.media_upload_tickets (community_id, created_at desc);

create index if not exists media_upload_tickets_expiry_idx
  on public.media_upload_tickets (expires_at)
  where finalized_at is null and rejected_at is null;

create unique index if not exists media_upload_tickets_final_key_idx
  on public.media_upload_tickets (final_key)
  where final_key is not null;

-- One atomic claim. A live claim is exclusive; an abandoned claim can be
-- reclaimed after the lease, which changes the token and makes the old
-- claimant's eventual commit fail.
create or replace function public.claim_media_upload_ticket(
  p_media_id uuid,
  p_user_id uuid,
  p_community_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.media_upload_tickets
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  update public.media_upload_tickets as ticket
     set claim_token = p_claim_token,
         claim_started_at = now(),
         claim_attempts = ticket.claim_attempts + 1,
         last_error = null
   where ticket.media_id = p_media_id
     and ticket.user_id = p_user_id
     and ticket.community_id = p_community_id
     and ticket.finalized_at is null
     and ticket.rejected_at is null
     and ticket.expires_at > now()
     and (
       ticket.claim_token is null
       or ticket.claim_started_at is null
       or ticket.claim_started_at <
         now() - make_interval(secs => greatest(p_lease_seconds, 1))
     )
  returning ticket.*;
$function$;

create or replace function public.commit_media_upload_ticket(
  p_media_id uuid,
  p_claim_token uuid,
  p_final_key text,
  p_final_poster_key text,
  p_final_size bigint
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  with updated as (
    update public.media_upload_tickets
       set finalized_at = now(),
           final_key = p_final_key,
           final_poster_key = p_final_poster_key,
           final_size = p_final_size,
           claim_token = null,
           claim_started_at = null
     where media_id = p_media_id
       and claim_token = p_claim_token
       and finalized_at is null
       and rejected_at is null
    returning 1
  )
  select exists (select 1 from updated);
$function$;

create or replace function public.release_media_upload_ticket(
  p_media_id uuid,
  p_claim_token uuid,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  with updated as (
    update public.media_upload_tickets
       set claim_token = null,
           claim_started_at = null,
           last_error = left(p_error, 500)
     where media_id = p_media_id
       and claim_token = p_claim_token
       and finalized_at is null
       and rejected_at is null
    returning 1
  )
  select exists (select 1 from updated);
$function$;

create or replace function public.reject_media_upload_ticket(
  p_media_id uuid,
  p_claim_token uuid,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  with updated as (
    update public.media_upload_tickets
       set rejected_at = now(),
           claim_token = null,
           claim_started_at = null,
           last_error = left(p_error, 500)
     where media_id = p_media_id
       and claim_token = p_claim_token
       and finalized_at is null
    returning 1
  )
  select exists (select 1 from updated);
$function$;

alter table public.media_upload_tickets enable row level security;
revoke all on table public.media_upload_tickets from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.media_upload_tickets to service_role;

revoke all on function public.claim_media_upload_ticket(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_media_upload_ticket(uuid, uuid, text, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.release_media_upload_ticket(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_media_upload_ticket(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_media_upload_ticket(uuid, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.commit_media_upload_ticket(uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.release_media_upload_ticket(uuid, uuid, text) to service_role;
grant execute on function public.reject_media_upload_ticket(uuid, uuid, text) to service_role;

comment on table public.media_upload_tickets is
  'One row per direct-to-R2 showcase upload ticket: binds media_id to the requesting member/community and owns the claim/finalize/reject state machine that makes a finalize single-winner.';
