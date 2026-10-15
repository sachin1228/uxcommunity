-- ============================================================
-- Account deletion with event rooms
--
-- Incident 2026-10-15: deleting an account from the admin Users page returned
-- 500 —
--   insert or update on table "communities" violates foreign key constraint
--   "communities_event_id_fkey"
--   Key (event_id)=… is not present in table "community_events"
--
-- The account hosted events and owned (or belonged to) the rooms that linked
-- them. Account deletion cascades the events away, and the same transaction
-- keeps updating the rooms (handover, membership counter maintenance).
-- PostgreSQL skips the FK check on the first update of a row in a transaction
-- but re-checks on every later one, and trigger firing order decides whether
-- the counter update lands after the event cascade — when it does, the stale
-- link aborts the whole delete.
--
-- Fix under test — 20261015140000_event_room_link_repair: the BEFORE DELETE
-- handover trigger unlinks, up front, every room pointing at an event the
-- departing user hosts (and drops genuinely dangling links), so no later
-- update can re-check a dead link. Rooms keep their people and their chat;
-- only the link goes.
--
-- Fixtures are inserted inside a transaction and rolled back; row-level
-- triggers are bypassed while seeding (creation budgets + the counter
-- triggers, which would re-update the drifted rows mid-fixture).
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

set session_replication_role = replica;

insert into public.users (id, name, email, password_hash) values
  ('e1000000-0000-0000-0000-000000000001', 'Event fixture owner', 'event-owner@event-room.test', 'x'),
  ('e1000000-0000-0000-0000-000000000002', 'Event fixture successor', 'event-succ@event-room.test', 'x'),
  ('e1000000-0000-0000-0000-000000000003', 'Event fixture loner', 'event-loner@event-room.test', 'x'),
  ('e1000000-0000-0000-0000-000000000004', 'Event fixture other', 'event-other@event-room.test', 'x');

insert into public.communities (id, name, type, owner_id, is_active) values
  ('e1000000-0000-0000-0000-0000000000c4', 'Event fixture host', 'user',
   'e1000000-0000-0000-0000-000000000002', true);

-- e1 belongs to the successor and survives; e2 + e3 are the departing user's
-- and die with them.
insert into public.community_events (id, community_id, user_id, title, event_date) values
  ('e1000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-0000000000c4',
   'e1000000-0000-0000-0000-000000000002', 'Event fixture e1', now()),
  ('e1000000-0000-0000-0000-0000000000e2', 'e1000000-0000-0000-0000-0000000000c4',
   'e1000000-0000-0000-0000-000000000001', 'Event fixture e2', now()),
  ('e1000000-0000-0000-0000-0000000000e3', 'e1000000-0000-0000-0000-0000000000c4',
   'e1000000-0000-0000-0000-000000000001', 'Event fixture e3', now());

-- c1 (their room, surviving event), c5 (their room, their event — the
-- incident shape), c6 (someone else's room, their event), plus a drifted
-- room each for the owner and for the loner.
insert into public.communities (id, name, type, owner_id, event_id, is_active) values
  ('e1000000-0000-0000-0000-0000000000c1', 'Fixture room, surviving link', 'event',
   'e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000e1', true),
  ('e1000000-0000-0000-0000-0000000000c5', 'Fixture room of their event', 'event',
   'e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000e2', true),
  ('e1000000-0000-0000-0000-0000000000c6', 'Fixture others room, their event', 'event',
   'e1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-0000000000e3', true),
  ('e1000000-0000-0000-0000-0000000000c2', 'Fixture drifted room', 'event',
   'e1000000-0000-0000-0000-000000000001', '458f40d4-36b8-48fb-a83a-7686bc75a324', true),
  ('e1000000-0000-0000-0000-0000000000c3', 'Fixture drifted room, nobody left', 'event',
   'e1000000-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-000000000000', true);

insert into public.community_members (community_id, user_id, role) values
  ('e1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('e1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000002', 'member'),
  ('e1000000-0000-0000-0000-0000000000c5', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('e1000000-0000-0000-0000-0000000000c5', 'e1000000-0000-0000-0000-000000000002', 'member'),
  ('e1000000-0000-0000-0000-0000000000c6', 'e1000000-0000-0000-0000-000000000004', 'owner'),
  ('e1000000-0000-0000-0000-0000000000c6', 'e1000000-0000-0000-0000-000000000001', 'member'),
  ('e1000000-0000-0000-0000-0000000000c2', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('e1000000-0000-0000-0000-0000000000c2', 'e1000000-0000-0000-0000-000000000002', 'member');

set session_replication_role = origin;

-- ─── The failing admin path ─────────────────────────────────
delete from public.users where id = 'e1000000-0000-0000-0000-000000000001';
delete from public.users where id = 'e1000000-0000-0000-0000-000000000003';

select ok(true, 'account deletions completed without a 23503');

-- ─── Outcomes ───────────────────────────────────────────────

select is(
  (select owner_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'e1000000-0000-0000-0000-000000000002'::uuid,
  'room of a surviving event is handed to the successor');
select is(
  (select event_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'e1000000-0000-0000-0000-0000000000e1'::uuid,
  'surviving event link is NOT over-nulled');

select is(
  (select owner_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c5'),
  'e1000000-0000-0000-0000-000000000002'::uuid,
  'their room of their own event is handed to the successor');
select is(
  (select event_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c5'),
  null::uuid,
  'their room loses the link to the event they hosted');

select is(
  (select owner_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c6'),
  'e1000000-0000-0000-0000-000000000004'::uuid,
  'someone else''s room keeps its owner');
select is(
  (select event_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c6'),
  null::uuid,
  'someone else''s room loses the link to their hosted event');
select ok(
  not exists (select 1 from public.community_members
              where community_id = 'e1000000-0000-0000-0000-0000000000c6'
                and user_id = 'e1000000-0000-0000-0000-000000000001'),
  'their membership in that room is gone with the account');

select is(
  (select owner_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c2'),
  'e1000000-0000-0000-0000-000000000002'::uuid,
  'drifted room is handed to the successor');
select is(
  (select event_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c2'),
  null::uuid,
  'the drifted link is dropped');

select ok(
  not exists (select 1 from public.communities where id = 'e1000000-0000-0000-0000-0000000000c3'),
  'drifted room with nobody left is removed with its owner');
select ok(
  not exists (select 1 from public.community_events
              where user_id = 'e1000000-0000-0000-0000-000000000001'),
  'their hosted events are gone with the account');
select ok(
  exists (select 1 from public.community_events
          where id = 'e1000000-0000-0000-0000-0000000000e1'),
  'the successor''s event survives');

select finish();
rollback;
