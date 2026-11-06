-- ============================================================
-- AUD-50 — durable membership-revocation queue
--
-- Migration under test: 20261106130000_realtime_membership_revocations.sql
--
-- The immediate realtime close is best-effort; this table is the durable
-- intent that survives a realtime outage. One row per (user, community),
-- reopened by a later removal after a rejoin, is what lets the processor
-- distinguish "still pending" from "already closed".
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table(
  'public', 'realtime_membership_revocations',
  'membership revocation queue exists'
);

select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.realtime_membership_revocations'::regclass),
  'row level security is enabled'
);

select ok(
  not has_table_privilege('anon', 'public.realtime_membership_revocations', 'INSERT')
  and has_table_privilege('service_role', 'public.realtime_membership_revocations', 'INSERT'),
  'only service_role may write the queue'
);

select is(
  (select count(*)::int
     from pg_constraint
    where conrelid = 'public.realtime_membership_revocations'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(user_id, community_id)%'),
  1,
  'one queue row per user and community'
);

select has_index(
  'public', 'realtime_membership_revocations',
  'realtime_membership_revocations_due_idx',
  'the due-row scan is indexed'
);

-- ─── Fixture + reopen semantics ─────────────────────────────
create temporary table revocation_fixture as
select gen_random_uuid() as user_id,
       gen_random_uuid() as city_id,
       gen_random_uuid() as community_id;

insert into public.users (id, name, email, password_hash)
select user_id, 'AUD-50 revocation fixture',
       format('%s@revocation.test', user_id), 'x'
from revocation_fixture;

insert into public.cities (id, name)
select city_id, format('AUD-50 city %s', city_id)
from revocation_fixture;

insert into public.communities (id, name, type, reference_id)
select community_id, 'AUD-50 community', 'city', city_id
from revocation_fixture;

insert into public.realtime_membership_revocations
  (user_id, community_id, attempts, next_attempt_at, completed_at, created_at)
select user_id, community_id, 0, now(), now(), now() - interval '1 hour'
from revocation_fixture;

insert into public.realtime_membership_revocations
  (user_id, community_id, attempts, next_attempt_at, completed_at, last_error)
select user_id, community_id, 0, now(), null, null
from revocation_fixture
on conflict (user_id, community_id) do update
  set attempts = 0,
      next_attempt_at = now(),
      completed_at = null,
      last_error = null,
      created_at = now();

select is(
  (select count(*)::int
     from public.realtime_membership_revocations
    where completed_at is null),
  1,
  'a later removal reopens the completed row instead of duplicating it'
);

select is(
  (select created_at > now() - interval '5 seconds'
     from public.realtime_membership_revocations),
  true,
  'reopening a completed row advances its generation'
);

-- ─── Atomic membership delete + queue write ───────────────
insert into public.community_members (community_id, user_id)
select community_id, user_id from revocation_fixture;

select is(
  public.remove_community_member_with_revocation(
    (select community_id from revocation_fixture),
    (select user_id from revocation_fixture)
  ),
  true,
  'the atomic removal deletes the membership and queues the revocation'
);

select is(
  (select count(*)::int from public.community_members
    where community_id = (select community_id from revocation_fixture)
      and user_id = (select user_id from revocation_fixture)),
  0,
  'the membership row is gone'
);

select is(
  (select count(*)::int from public.realtime_membership_revocations
    where community_id = (select community_id from revocation_fixture)
      and user_id = (select user_id from revocation_fixture)
      and completed_at is null),
  1,
  'a pending revocation row exists after the atomic removal'
);

select is(
  public.remove_community_member_with_revocation(
    (select community_id from revocation_fixture),
    (select user_id from revocation_fixture)
  ),
  false,
  'a second atomic removal reports no membership'
);

select * from finish();
rollback;
