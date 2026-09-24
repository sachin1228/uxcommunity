begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select has_function('public', 'get_community_message_page', array['uuid','uuid','timestamptz','timestamptz','timestamptz','integer']);
select has_function('public', 'get_sidebar_activity', array['uuid']);
select has_function('public', 'get_all_communities', array['uuid']);
select has_function('public', 'get_thread_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_event_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_resource_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_showcase_list_page', array['uuid','uuid','timestamptz','uuid','integer']);
select has_function('public', 'get_home_feed_page', array['uuid','timestamptz','integer','text']);
select has_function('public', 'get_home_feed_page', array['uuid','timestamptz','integer','boolean']);
select has_function('public', 'get_profile_feed_page', array['uuid','text','timestamptz','integer']);

create temporary table rpc_test_context as
select community_id, user_id, joined_at
from public.community_members
order by joined_at
limit 1;

select ok(exists(select 1 from rpc_test_context), 'seeded test database has a community member fixture');

insert into public.community_messages (community_id, user_id, content, created_at)
select context.community_id, context.user_id, 'rpc pagination fixture ' || series.value,
  clock_timestamp() + series.value * interval '1 millisecond'
from rpc_test_context as context
cross join generate_series(1, 60) as series(value);

create temporary table rpc_test_cursor as
select min(created_at) - interval '1 millisecond' as value
from public.community_messages
where content like 'rpc pagination fixture %';

select is(
  (select count(*)::integer
   from rpc_test_context context, rpc_test_cursor cursor,
   lateral public.get_community_message_page(context.community_id, context.user_id, context.joined_at, null, cursor.value, 50)),
  50,
  'after pagination returns one bounded page'
);

select is(
  (select min(content) from (
    select content
    from rpc_test_context context, rpc_test_cursor cursor,
    lateral public.get_community_message_page(context.community_id, context.user_id, context.joined_at, null, cursor.value, 50)
    order by created_at asc
    limit 1
  ) first_message),
  'rpc pagination fixture 1',
  'after pagination starts with the earliest missed message'
);

select is(
  (select count(*)::integer from rpc_test_context context,
    lateral public.get_event_list_aggregates(context.user_id, '{}'::uuid[])),
  0,
  'event aggregate RPC handles an empty page'
);

select ok(
  not exists(
    select 1
    from rpc_test_context context,
      lateral public.get_all_communities(context.user_id) community
    where community.member_count <= 0
  ),
  'community explore RPC excludes empty communities'
);

-- Feed-scope fixtures. Every card lives in a community (standalone posts were
-- removed), so the two scopes split on membership and visibility:
--   * a joined community contributes public AND private posts to the member
--     scope, and nothing to the public feed;
--   * an unjoined community contributes its public posts to the public feed
--     only.
insert into public.community_showcase_posts
  (community_id, user_id, title, description, image_url, post_type, category, tags, is_public, created_at)
select null, context.user_id, 'standalone showcase fixture', 'no community', 'https://example.com/fixture.png', 'finished', 'ui_ux', array['fixture'], true, clock_timestamp()
from rpc_test_context as context;

create temporary table rpc_test_other_community as
select community.id as community_id
from public.communities community
where not exists (
  select 1 from public.community_members member
  where member.community_id = community.id
    and member.user_id = (select user_id from rpc_test_context)
)
order by community.id
limit 1;

insert into public.community_threads
  (community_id, user_id, title, description, category, tags, attachments, links, allow_replies, is_public, created_at)
select context.community_id, context.user_id, 'private joined-community thread fixture', 'member scope only', 'question', array['fixture'], '[]'::jsonb, array[]::text[], true, false, clock_timestamp()
from rpc_test_context as context;

insert into public.community_showcase_posts
  (community_id, user_id, title, description, image_url, post_type, category, tags, is_public, created_at)
select context.community_id, context.user_id, 'public joined-community showcase fixture', 'member scope only', 'https://example.com/fixture.png', 'finished', 'ui_ux', array['fixture'], true, clock_timestamp()
from rpc_test_context as context;

insert into public.community_threads
  (community_id, user_id, title, description, category, tags, attachments, links, allow_replies, is_public, created_at)
select other.community_id, context.user_id, 'public unjoined-community thread fixture', 'public feed only', 'question', array['fixture'], '[]'::jsonb, array[]::text[], true, true, clock_timestamp()
from rpc_test_context as context, rpc_test_other_community as other;

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'public'::text) feed
   where feed.item->>'_type' = 'showcase'
     and feed.item->>'title' = 'standalone showcase fixture'),
  0,
  'public feed excludes posts with no community'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'public'::text) feed
   where feed.item->>'title' = 'private joined-community thread fixture'),
  0,
  'public feed excludes private posts from joined communities'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'public'::text) feed
   where feed.item->>'title' = 'public joined-community showcase fixture'),
  0,
  'public feed excludes public posts from joined communities'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'public'::text) feed
   where feed.item->>'title' = 'public unjoined-community thread fixture'),
  1,
  'public feed includes public posts from communities the caller has not joined'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'communities'::text) feed
   where feed.item->>'title' = 'private joined-community thread fixture'),
  1,
  'member feed includes private posts from joined communities'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'communities'::text) feed
   where feed.item->>'title' = 'public joined-community showcase fixture'),
  1,
  'member feed includes public posts from joined communities'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'communities'::text) feed
   where feed.item->>'title' = 'public unjoined-community thread fixture'),
  0,
  'member feed excludes communities the caller has not joined'
);

-- The legacy scope is what clients that send no scope still get, so its
-- every-public-post behaviour must survive the split.
select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'all'::text) feed
   where feed.item->>'title' = 'public joined-community showcase fixture'),
  1,
  'legacy all scope still includes public posts from joined communities'
);

-- The pre-`p_scope` call shape delegates to the scoped function.
select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, true) feed
   where feed.item->>'title' = 'private joined-community thread fixture'),
  1,
  'legacy boolean flag delegates to the member scope'
);

select is(
  (select feed.item->'users'->>'name' is not null
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100, 'communities'::text) feed
   where feed.item->>'_type' = 'thread'
     and feed.item->>'title' = 'private joined-community thread fixture'
   limit 1),
  true,
  'feed thread items include author metadata'
);

-- The profile activity tabs read the same card payloads as the homepage. A
-- member with no posts and no saves must get an empty page for every scope
-- rather than an error, so an empty profile still renders its tabs.
select is(
  (select count(*)::integer
   from public.get_profile_feed_page('00000000-0000-0000-0000-000000000000'::uuid, 'all', null, 30)),
  0,
  'profile feed returns nothing for a member with no posts'
);

select is(
  (select count(*)::integer
   from public.get_profile_feed_page('00000000-0000-0000-0000-000000000000'::uuid, 'saved', null, 30)),
  0,
  'profile saved scope returns nothing for a member with no saves'
);

-- Scope: a member who belongs to no communities gets nothing from the
-- member-only feed.
select is(
  (select count(*)::integer
   from public.get_home_feed_page('00000000-0000-0000-0000-000000000000'::uuid, null, 100, true)),
  0,
  'member-only home feed excludes communities the caller has not joined'
);

select * from finish();
rollback;
