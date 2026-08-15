begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select has_function('public', 'get_community_message_page', array['uuid','uuid','timestamptz','timestamptz','timestamptz','integer']);
select has_function('public', 'get_sidebar_activity', array['uuid']);
select has_function('public', 'get_all_communities', array['uuid']);
select has_function('public', 'get_thread_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_event_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_resource_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_showcase_list_page', array['uuid','uuid','timestamptz','uuid','integer']);
select has_function('public', 'get_home_feed_page', array['uuid','timestamptz','integer']);

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

insert into public.community_showcase_posts
  (community_id, user_id, title, description, image_url, post_type, category, tags, is_public, created_at)
select null, context.user_id, 'public showcase fixture', 'shown on home feed', 'https://example.com/fixture.png', 'finished', 'ui_ux', array['fixture'], true, clock_timestamp()
from rpc_test_context as context;

insert into public.community_showcase_posts
  (community_id, user_id, title, description, image_url, post_type, category, tags, is_public, created_at)
select context.community_id, context.user_id, 'community showcase fixture', 'hidden from home feed', 'https://example.com/fixture.png', 'finished', 'ui_ux', array['fixture'], false, clock_timestamp()
from rpc_test_context as context;

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100) feed
   where feed.item->>'_type' = 'showcase'
     and feed.item->>'title' = 'public showcase fixture'),
  1,
  'home feed includes public showcase posts'
);

select is(
  (select count(*)::integer
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100) feed
   where feed.item->>'_type' = 'showcase'
     and feed.item->>'title' = 'community showcase fixture'),
  0,
  'home feed excludes non-public showcase posts'
);

select is(
  (select feed.item->>'author' is not null
   from rpc_test_context context,
     lateral public.get_home_feed_page(context.user_id, null, 100) feed
   where feed.item->>'_type' = 'showcase'
   limit 1),
  true,
  'home feed showcase items include author metadata'
);

select * from finish();
rollback;
