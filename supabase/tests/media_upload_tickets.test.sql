-- ============================================================
-- AUD-07 — media_upload_tickets ownership and one-winner finalize
--
-- Migration under test: 20261106120000_media_upload_tickets.sql
--
-- Finalize is a claim-based state machine, not a read-then-write. These
-- assertions pin the concurrency properties the route relies on:
--   * one live claim per ticket; a second finalize cannot claim;
--   * a commit requires the winning claim token (a loser cannot commit);
--   * an abandoned claim can be reclaimed after its lease, and the old
--     claimant still cannot commit;
--   * release returns a ticket to pending for a retry;
--   * the canonical key recorded on commit is the winner's claim-specific key.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('public', 'media_upload_tickets', 'ticket table exists');
select col_is_pk('public', 'media_upload_tickets', 'id', 'ticket id is the primary key');
select col_is_unique('public', 'media_upload_tickets', 'media_id', 'one ticket per media id');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.media_upload_tickets'::regclass),
  'row level security is enabled'
);
select ok(
  not has_table_privilege('anon', 'public.media_upload_tickets', 'INSERT')
  and has_table_privilege('service_role', 'public.media_upload_tickets', 'INSERT'),
  'only service_role may insert tickets'
);

select has_function(
  'public', 'claim_media_upload_ticket',
  array['uuid', 'uuid', 'uuid', 'uuid', 'integer'],
  'claim function exists'
);
select has_function(
  'public', 'commit_media_upload_ticket',
  array['uuid', 'uuid', 'text', 'text', 'bigint'],
  'commit function exists'
);
select has_function(
  'public', 'release_media_upload_ticket',
  array['uuid', 'uuid', 'text'],
  'release function exists'
);
select has_function(
  'public', 'reject_media_upload_ticket',
  array['uuid', 'uuid', 'text'],
  'reject function exists'
);

-- ─── Fixtures ───────────────────────────────────────────────
create temporary table ticket_fixture as
select gen_random_uuid() as user_id,
       gen_random_uuid() as city_id,
       gen_random_uuid() as community_id,
       gen_random_uuid() as media_one,
       gen_random_uuid() as media_two;

insert into public.users (id, name, email, password_hash)
select user_id, 'AUD-07 ticket fixture', format('%s@ticket.test', user_id), 'x'
from ticket_fixture;

insert into public.cities (id, name)
select city_id, format('AUD-07 city %s', city_id)
from ticket_fixture;

insert into public.communities (id, name, type, reference_id)
select community_id, 'AUD-07 community', 'city', city_id
from ticket_fixture;

insert into public.media_upload_tickets
  (media_id, user_id, community_id, staging_key, content_type, expected_size, expires_at)
select media_one, user_id, community_id,
       'media/videos/processed/' || media_one || '.mp4',
       'video/mp4', 1000, now() + interval '10 minutes'
from ticket_fixture;

-- ─── One live claim ─────────────────────────────────────────
select is(
  (select count(*)::int from public.claim_media_upload_ticket(
    (select media_one from ticket_fixture),
    (select user_id from ticket_fixture),
    (select community_id from ticket_fixture),
    '11111111-1111-4111-8111-111111111111',
    120
  )),
  1,
  'the first finalize claims the ticket'
);

select is(
  (select count(*)::int from public.claim_media_upload_ticket(
    (select media_one from ticket_fixture),
    (select user_id from ticket_fixture),
    (select community_id from ticket_fixture),
    '22222222-2222-4222-8222-222222222222',
    120
  )),
  0,
  'a second finalize cannot claim while the first lease is live'
);

select is(
  public.commit_media_upload_ticket(
    (select media_one from ticket_fixture),
    '11111111-1111-4111-8111-111111111111',
    'media/videos/finalized/' || (select media_one from ticket_fixture) || '/11111111-1111-4111-8111-111111111111.mp4',
    null,
    1000
  ),
  true,
  'the winning claim commits'
);

select is(
  public.commit_media_upload_ticket(
    (select media_one from ticket_fixture),
    '22222222-2222-4222-8222-222222222222',
    'media/videos/finalized/' || (select media_one from ticket_fixture) || '/loser.mp4',
    null,
    1000
  ),
  false,
  'a losing claim cannot commit'
);

select is(
  (select final_key from public.media_upload_tickets limit 1),
  'media/videos/finalized/' || (select media_one from ticket_fixture) || '/11111111-1111-4111-8111-111111111111.mp4',
  'the committed key belongs to the winner'
);

-- ─── Stale lease recovery ──────────────────────────────────
insert into public.media_upload_tickets
  (media_id, user_id, community_id, staging_key, content_type, expected_size, expires_at,
   claim_token, claim_started_at, claim_attempts)
select media_two, user_id, community_id,
       'media/videos/processed/' || media_two || '.mp4',
       'video/mp4', 1000, now() + interval '10 minutes',
       '33333333-3333-4333-8333-333333333333',
       now() - interval '5 minutes', 1
from ticket_fixture;

select is(
  (select count(*)::int from public.claim_media_upload_ticket(
    (select media_two from ticket_fixture),
    (select user_id from ticket_fixture),
    (select community_id from ticket_fixture),
    '44444444-4444-4444-8444-444444444444',
    120
  )),
  1,
  'an abandoned claim can be reclaimed after the lease'
);

select is(
  public.commit_media_upload_ticket(
    (select media_two from ticket_fixture),
    '33333333-3333-4333-8333-333333333333',
    'media/videos/finalized/' || (select media_two from ticket_fixture) || '/stale.mp4',
    null,
    1000
  ),
  false,
  'the stale claimant cannot commit after the reclaim'
);

select is(
  public.commit_media_upload_ticket(
    (select media_two from ticket_fixture),
    '44444444-4444-4444-8444-444444444444',
    'media/videos/finalized/' || (select media_two from ticket_fixture) || '/44444444-4444-4444-8444-444444444444.mp4',
    null,
    1000
  ),
  true,
  'the reclaimer commits'
);

-- ─── Release and retry ─────────────────────────────────────
create temporary table release_ticket (media_id uuid);
with inserted as (
  insert into public.media_upload_tickets
    (media_id, user_id, community_id, staging_key, content_type, expected_size, expires_at)
  select gen_random_uuid(), user_id, community_id,
         'media/videos/processed/' || gen_random_uuid() || '.mp4',
         'video/mp4', 1000, now() + interval '10 minutes'
  from ticket_fixture
  returning media_id
)
insert into release_ticket select media_id from inserted;

select is(
  (select count(*)::int from public.claim_media_upload_ticket(
    (select media_id from release_ticket),
    (select user_id from ticket_fixture),
    (select community_id from ticket_fixture),
    'aaaaaaaa-7777-4777-8777-777777777777',
    120
  )),
  1,
  'a pending ticket can be claimed'
);

select is(
  public.release_media_upload_ticket(
    (select media_id from release_ticket),
    'aaaaaaaa-7777-4777-8777-777777777777',
    'transient copy failure'
  ),
  true,
  'a transient failure releases the claim'
);

select is(
  public.commit_media_upload_ticket(
    (select media_id from release_ticket),
    'aaaaaaaa-7777-4777-8777-777777777777',
    'media/videos/finalized/released.mp4',
    null,
    1000
  ),
  false,
  'a released claim cannot commit'
);

select is(
  public.reject_media_upload_ticket(
    (select media_id from release_ticket),
    'aaaaaaaa-7777-4777-8777-777777777777',
    'not the claim'
  ),
  false,
  'a released claim cannot reject'
);

select is(
  (select count(*)::int from public.claim_media_upload_ticket(
    (select media_id from release_ticket),
    (select user_id from ticket_fixture),
    (select community_id from ticket_fixture),
    'bbbbbbbb-8888-4888-8888-888888888888',
    120
  )),
  1,
  'a released ticket can be claimed again'
);

select is(
  public.commit_media_upload_ticket(
    (select media_id from release_ticket),
    'bbbbbbbb-8888-4888-8888-888888888888',
    'media/videos/finalized/' || (select media_id from release_ticket) || '/bbbbbbbb-8888-4888-8888-888888888888.mp4',
    null,
    1000
  ),
  true,
  'the post-release claim commits'
);

select is(
  (select count(*)::int from public.media_upload_tickets
    where finalized_at is null and rejected_at is null),
  0,
  'no ticket remains pending after the retry'
);

select is(
  (select count(*)::int from public.claim_media_upload_ticket(
    'eeeeeeee-5555-4555-8555-555555555555',
    (select user_id from ticket_fixture),
    (select community_id from ticket_fixture),
    'eeeeeeee-5555-4555-8555-555555555555',
    120
  )),
  0,
  'a non-existent ticket cannot be claimed'
);

select is(
  has_function_privilege('anon', 'public.claim_media_upload_ticket(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  false,
  'anon cannot execute the claim function'
);

select is(
  has_function_privilege('service_role', 'public.claim_media_upload_ticket(uuid,uuid,uuid,uuid,integer)', 'EXECUTE'),
  true,
  'service_role can execute the claim function'
);

select * from finish();
rollback;
