-- ============================================================
-- Account deletion with a drifted event-room link
--
-- Incident 2026-10-15: deleting an account from the admin Users page returned
-- 500 —
--   insert or update on table "communities" violates foreign key constraint
--   "communities_event_id_fkey"
--   Key (event_id)=… is not present in table "community_events"
--
-- The account owned a room whose communities.event_id pointed at an event row
-- that no longer exists. PostgreSQL's FK check skips the first update of a row
-- in a transaction, but every later update of that row re-checks the
-- constraint — and account deletion updates each owned room twice (the BEFORE
-- DELETE handover, then the membership counter maintenance the cascade
-- triggers), so the stale link aborted the whole deletion.
--
-- Fix under test — 20261015140000_event_room_link_repair: the handover in
-- 20260913150000_community_ownership_on_user_delete now drops a stale link
-- before reassigning the room, and the migration nulls the drifted links
-- already in the database (the same end state event deletion produces: the
-- room outlives its event, only the link goes).
--
-- A drifted row cannot be created while the FK is enforced, so the fixtures
-- seed it with the row-level triggers bypassed — the way the live row came to
-- exist (surgery or a restore predating the constraint).
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- The repair migration re-asserts the canonical constraint, validated.
select ok(
  (select convalidated from pg_constraint
    where conname = 'communities_event_id_fkey'
      and conrelid = 'public.communities'::regclass),
  'the canonical event FK exists and is validated');

-- ─── Fixture ────────────────────────────────────────────────
-- Row-level triggers are bypassed for the whole fixture: community inserts
-- skip the per-member creation budgets, membership inserts skip the counter
-- triggers (which would re-update the drifted room and trip the stale link
-- while seeding), and the drifted links become writable at all.
set session_replication_role = replica;

insert into public.users (id, name, email, password_hash) values
  ('e1000000-0000-0000-0000-000000000001', 'Drift fixture owner', 'drift-owner@event-room.test', 'x'),
  ('e1000000-0000-0000-0000-000000000002', 'Drift fixture successor', 'drift-succ@event-room.test', 'x'),
  ('e1000000-0000-0000-0000-000000000003', 'Drift fixture loner', 'drift-loner@event-room.test', 'x');

-- The event a healthy room still links to. Its host community is a plain
-- fixture row; the event itself is hosted by the successor, so deleting the
-- owner below never cascades the event away.
insert into public.communities (id, name, type, owner_id, is_active) values
  ('e1000000-0000-0000-0000-0000000000c4', 'Drift fixture event host', 'user',
   'e1000000-0000-0000-0000-000000000002', true);

insert into public.community_events (id, community_id, user_id, title, event_date) values
  ('e1000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-0000000000c4',
   'e1000000-0000-0000-0000-000000000002', 'Drift fixture event', now());

-- The healthy room, and the drifted ones — their event rows are already gone.
insert into public.communities (id, name, type, owner_id, event_id, is_active) values
  ('e1000000-0000-0000-0000-0000000000c1', 'Healthy event room', 'event',
   'e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-0000000000e1', true),
  ('e1000000-0000-0000-0000-0000000000c2', 'Drifted event room', 'event',
   'e1000000-0000-0000-0000-000000000001', '458f40d4-36b8-48fb-a83a-7686bc75a324', true),
  ('e1000000-0000-0000-0000-0000000000c3', 'Drifted room, nobody left', 'event',
   'e1000000-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-000000000000', true);

insert into public.community_members (community_id, user_id, role) values
  ('e1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('e1000000-0000-0000-0000-0000000000c1', 'e1000000-0000-0000-0000-000000000002', 'member'),
  ('e1000000-0000-0000-0000-0000000000c2', 'e1000000-0000-0000-0000-000000000001', 'owner'),
  ('e1000000-0000-0000-0000-0000000000c2', 'e1000000-0000-0000-0000-000000000002', 'member');

set session_replication_role = origin;

-- ─── The failing admin path ─────────────────────────────────
-- Plain user deletes, exactly what the admin route sends; the BEFORE DELETE
-- trigger hands each owned room over and the cascade does the rest. Before the
-- fix the owner's delete raised 23503 on the drifted room and stopped here.

delete from public.users where id = 'e1000000-0000-0000-0000-000000000001';
delete from public.users where id = 'e1000000-0000-0000-0000-000000000003';

select ok(true, 'account deletions completed without a 23503');

-- ─── Handover outcomes ──────────────────────────────────────

select is(
  (select owner_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'e1000000-0000-0000-0000-000000000002'::uuid,
  'healthy room is handed to the longest-standing remaining member');
select is(
  (select event_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'e1000000-0000-0000-0000-0000000000e1'::uuid,
  'healthy room keeps its event link');
select is(
  (select owner_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c2'),
  'e1000000-0000-0000-0000-000000000002'::uuid,
  'drifted room is handed to the longest-standing remaining member');
select is(
  (select event_id from public.communities where id = 'e1000000-0000-0000-0000-0000000000c2'),
  null::uuid,
  'the drifted link is dropped during the handover');
select is(
  (select role from public.community_members
    where community_id = 'e1000000-0000-0000-0000-0000000000c2'
      and user_id = 'e1000000-0000-0000-0000-000000000002'),
  'owner',
  'successor holds the owner membership in the drifted room');
select ok(
  not exists (select 1 from public.communities where id = 'e1000000-0000-0000-0000-0000000000c3'),
  'drifted room with nobody left is removed with its owner');

select finish();
rollback;
