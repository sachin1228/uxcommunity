-- Stage 4 AUD-P4 — event RSVP capacity is a database invariant.
--
-- The API used to read the attendee count and then insert, so N concurrent
-- requests all saw "not full" and all inserted. The trigger takes the event
-- row lock first, which serializes capacity checks for that event across
-- transactions; the count then sees every committed RSVP. The primary key
-- (event_id, user_id) already prevents a duplicate registration.
--
-- The trigger only rejects an INSERT that would exceed the limit. Existing
-- behaviour (including cancelling and re-joining) is unchanged.

create or replace function public.enforce_event_rsvp_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer;
  v_attendees integer;
begin
  -- An idempotent re-join (INSERT ... ON CONFLICT DO NOTHING) must not be
  -- rejected just because the event is full: it adds no attendee.
  if exists (
    select 1 from public.event_rsvps r
    where r.event_id = new.event_id and r.user_id = new.user_id
  ) then
    return new;
  end if;

  select e.max_attendees
  into v_limit
  from public.community_events e
  where e.id = new.event_id
  for update;

  if v_limit is null then
    return new;
  end if;

  -- The pre-lock check can have raced a concurrent insert of the same member;
  -- re-check after waiting so an idempotent re-join is never mistaken for a
  -- new attendee.
  if exists (
    select 1 from public.event_rsvps r
    where r.event_id = new.event_id and r.user_id = new.user_id
  ) then
    return new;
  end if;

  select count(*)
  into v_attendees
  from public.event_rsvps r
  where r.event_id = new.event_id;

  if v_attendees >= v_limit then
    raise exception 'EVENT_CAPACITY_REACHED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_event_rsvps_capacity on public.event_rsvps;
create trigger trg_event_rsvps_capacity
  before insert on public.event_rsvps
  for each row execute function public.enforce_event_rsvp_capacity();

-- Attendee previews read the newest five rows for an event; the PK orders by
-- user id, so it cannot serve that order.
create index idx_event_rsvps_event_created
  on public.event_rsvps (event_id, created_at);
