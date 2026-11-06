-- Stage 4 AUD-P5 — member search is backed by a trigram index and treats
-- LIKE wildcards as literal characters.
--
-- `%` used to widen the pattern into "match every member"; `_` matched any
-- single character. The escaped pattern keeps the member's characters literal
-- and lets the GIN trigram index serve the leading-wildcard ILIKE.

select plan(9);

-- ─── Fixture ────────────────────────────────────────────────
delete from public.communities where id = 'c4c4c4c4-0000-4000-8000-000000000001';
delete from public.users where id::text like 'c4c4c4c4-0000-4000-8000-0000000000%';

insert into public.users (id, name, email, password_hash) values
  ('c4c4c4c4-0000-4000-8000-000000000001', 'Search Owner', 'search-owner@stage4.test', 'x'),
  ('c4c4c4c4-0000-4000-8000-000000000002', 'Alice Sharma', 'alice@stage4.test', 'x'),
  ('c4c4c4c4-0000-4000-8000-000000000003', 'Bob 100% Pat', 'bob@stage4.test', 'x'),
  ('c4c4c4c4-0000-4000-8000-000000000004', 'Casey Under_score', 'casey@stage4.test', 'x'),
  ('c4c4c4c4-0000-4000-8000-000000000005', 'Dave Plain', 'dave@stage4.test', 'x');

insert into public.communities (id, name, type, owner_id, is_public) values
  ('c4c4c4c4-0000-4000-8000-000000000001', 'Search bench', 'user',
   'c4c4c4c4-0000-4000-8000-000000000001', true);

insert into public.community_members (community_id, user_id, role) values
  ('c4c4c4c4-0000-4000-8000-000000000001', 'c4c4c4c4-0000-4000-8000-000000000001', 'owner'),
  ('c4c4c4c4-0000-4000-8000-000000000001', 'c4c4c4c4-0000-4000-8000-000000000002', 'member'),
  ('c4c4c4c4-0000-4000-8000-000000000001', 'c4c4c4c4-0000-4000-8000-000000000003', 'member'),
  ('c4c4c4c4-0000-4000-8000-000000000001', 'c4c4c4c4-0000-4000-8000-000000000004', 'member'),
  ('c4c4c4c4-0000-4000-8000-000000000001', 'c4c4c4c4-0000-4000-8000-000000000005', 'member');

update public.communities
set member_count = 5
where id = 'c4c4c4c4-0000-4000-8000-000000000001';

select has_index('public', 'users', 'idx_users_name_trgm',
  'users.name has a trigram GIN index');

-- ─── Ordinary search ────────────────────────────────────────
select is(
  (select count(*)::integer from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', 'sharma', 30, 0)),
  1,
  'a normal name search matches one member'
);
select is(
  (select total from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', 'sharma', 30, 0) limit 1),
  1::bigint,
  'the search total counts only the match'
);

-- ─── Wildcards are literal ──────────────────────────────────
select is(
  (select count(*)::integer from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', '100%', 30, 0)),
  1,
  'percent is matched literally'
);
select is(
  (select name from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', '%', 30, 0)),
  'Bob 100% Pat',
  'a bare percent matches only the member whose name contains it'
);
select is(
  (select name from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', '_', 30, 0)),
  'Casey Under_score',
  'underscore is matched literally'
);

-- ─── Unfiltered page still comes from the member counter ────
select is(
  (select count(*)::integer from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', null, 30, 0)),
  5,
  'the unfiltered roster is unchanged'
);
select is(
  (select total from public.get_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', null, 30, 0) limit 1),
  5::bigint,
  'the unfiltered total still reads communities.member_count'
);

-- ─── Admin twin receives the same escaping ──────────────────
select is(
  (select email from public.get_admin_community_members_page(
     'c4c4c4c4-0000-4000-8000-000000000001', 'sharma', 30, 0)),
  'alice@stage4.test',
  'admin search uses the same escaped pattern'
);

-- ─── Cleanup ────────────────────────────────────────────────
delete from public.communities where id = 'c4c4c4c4-0000-4000-8000-000000000001';
delete from public.users where id::text like 'c4c4c4c4-0000-4000-8000-0000000000%';

select * from finish();
