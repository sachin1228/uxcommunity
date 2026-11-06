-- Stage 4 AUD-P4 — event capacity cannot be oversold by concurrent RSVPs.
--
-- The trigger takes the event row lock before counting, so inserts for one
-- event serialize. This file commits its fixture because the competing
-- sessions must see it (same pattern as moderation_evidence_concurrency).

select plan(7);

-- ─── Fixture ────────────────────────────────────────────────
delete from public.event_rsvps
 where event_id = 'b3b3b3b3-0000-4000-8000-000000000001';
delete from public.communities
 where id = 'b3b3b3b3-0000-4000-8000-000000000002';
delete from public.community_events
 where id = 'b3b3b3b3-0000-4000-8000-000000000001';
delete from public.users
 where id::text like 'b3b3b3b3-0000-4000-8000-0000000000%';

insert into public.users (id, name, email, password_hash)
select ('b3b3b3b3-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       'RSVP racer ' || i, 'rsvp-racer-' || i || '@stage4.test', 'x'
from generate_series(1, 8) i;

insert into public.communities (id, name, type, owner_id, is_public) values
  ('b3b3b3b3-0000-4000-8000-000000000002', 'RSVP bench', 'user',
   'b3b3b3b3-0000-4000-8000-000000000001', true);

insert into public.community_events (id, community_id, user_id, title, event_date, max_attendees) values
  ('b3b3b3b3-0000-4000-8000-000000000001',
   'b3b3b3b3-0000-4000-8000-000000000002',
   'b3b3b3b3-0000-4000-8000-000000000001',
   'Only two seats', now() + interval '10 days', 2);

select has_trigger('public', 'event_rsvps', 'trg_event_rsvps_capacity',
  'the capacity check is a database trigger');
select has_index('public', 'event_rsvps', 'idx_event_rsvps_event_created',
  'attendee previews have an (event_id, created_at) index');

-- ─── Six concurrent joins for two seats ─────────────────────
\! bash -c "for i in 2 3 4 5 6 7; do uid=\"b3b3b3b3-0000-4000-8000-\$(printf '%012d' \$i)\"; psql -q -o /dev/null -c \"insert into public.event_rsvps (event_id, user_id) values ('b3b3b3b3-0000-4000-8000-000000000001', '\$uid') on conflict do nothing;\" 2>/dev/null & done; wait"

select is(
  (select count(*)::integer from public.event_rsvps
   where event_id = 'b3b3b3b3-0000-4000-8000-000000000001'),
  2,
  'six concurrent RSVPs leave exactly the two seats filled'
);

-- ─── An idempotent re-join is accepted even when full ───────
select user_id as winner from public.event_rsvps
 where event_id = 'b3b3b3b3-0000-4000-8000-000000000001'
 limit 1 \gset
insert into public.event_rsvps (event_id, user_id)
values ('b3b3b3b3-0000-4000-8000-000000000001', :'winner')
on conflict do nothing;

select is(
  (select count(*)::integer from public.event_rsvps
   where event_id = 'b3b3b3b3-0000-4000-8000-000000000001'),
  2,
  'a repeated join does not add an attendee or fail'
);

-- ─── The third distinct attendee is rejected atomically ─────
select throws_ok(
  $$insert into public.event_rsvps (event_id, user_id)
    values ('b3b3b3b3-0000-4000-8000-000000000001', 'b3b3b3b3-0000-4000-8000-000000000008')$$,
  'P0001',
  'EVENT_CAPACITY_REACHED',
  'a plain insert past capacity is rejected by the database'
);

-- ─── Cancellation frees a seat; the next join succeeds ──────
delete from public.event_rsvps
 where event_id = 'b3b3b3b3-0000-4000-8000-000000000001'
   and user_id = :'winner';

insert into public.event_rsvps (event_id, user_id)
values ('b3b3b3b3-0000-4000-8000-000000000001', 'b3b3b3b3-0000-4000-8000-000000000008');

select is(
  (select count(*)::integer from public.event_rsvps
   where event_id = 'b3b3b3b3-0000-4000-8000-000000000001'),
  2,
  'a cancelled seat can be taken by another member'
);

select is(
  (select count(distinct user_id)::integer from public.event_rsvps
   where event_id = 'b3b3b3b3-0000-4000-8000-000000000001'),
  2,
  'the attendee list has no duplicate member'
);

-- ─── Cleanup ────────────────────────────────────────────────
delete from public.event_rsvps
 where event_id = 'b3b3b3b3-0000-4000-8000-000000000001';
delete from public.communities
 where id = 'b3b3b3b3-0000-4000-8000-000000000002';
delete from public.community_events
 where id = 'b3b3b3b3-0000-4000-8000-000000000001';
delete from public.users
 where id::text like 'b3b3b3b3-0000-4000-8000-0000000000%';

select * from finish();
