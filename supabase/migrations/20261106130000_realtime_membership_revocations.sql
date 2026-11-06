-- Durable membership-revocation delivery.
--
-- Deleting the community_members row is the authorization change. Closing the
-- removed member's existing WebSocket is a best-effort side effect that can
-- fail when the realtime Worker is down or a request times out. A row here is
-- written before the membership delete and is retried by the realtime Worker's
-- minute cron until the Room DO confirms the close (or the member has rejoined
-- in the meantime, in which case the new sockets are legitimate).
--
-- One row per (user, community): a later removal after a rejoin reopens the
-- completed row instead of accumulating history.

create table if not exists public.realtime_membership_revocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  community_id uuid not null references communities(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamp with time zone not null default now(),
  last_error text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  unique (user_id, community_id)
);

create index if not exists realtime_membership_revocations_due_idx
  on public.realtime_membership_revocations (next_attempt_at)
  where completed_at is null;

alter table public.realtime_membership_revocations enable row level security;
revoke all on table public.realtime_membership_revocations from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.realtime_membership_revocations to service_role;

comment on table public.realtime_membership_revocations is
  'Durable retry queue for closing a removed member''s community WebSockets when the immediate realtime revocation fails. Completed rows are reopened by a later removal.';

-- Atomically delete the membership (and its moderator grants) and write the
-- durable revocation row. A crash can no longer lose the revocation between
-- two statements, and the queue row cannot exist for a member who is still in
-- the community.
create or replace function public.remove_community_member_with_revocation(
  p_community_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  removed bigint;
begin
  delete from public.community_admin_permissions
   where community_id = p_community_id
     and user_id = p_user_id;

  delete from public.community_members
   where community_id = p_community_id
     and user_id = p_user_id;

  get diagnostics removed = row_count;
  if removed = 0 then
    return false;
  end if;

  insert into public.realtime_membership_revocations
    (user_id, community_id, attempts, next_attempt_at, last_error, completed_at, created_at)
  values
    (p_user_id, p_community_id, 0, now(), null, null, now())
  on conflict (user_id, community_id) do update
    set attempts = 0,
        next_attempt_at = now(),
        last_error = null,
        completed_at = null,
        created_at = now();

  return true;
end;
$function$;

revoke all on function public.remove_community_member_with_revocation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.remove_community_member_with_revocation(uuid, uuid)
  to service_role;
