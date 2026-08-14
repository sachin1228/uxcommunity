begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_function('public', 'get_community_message_page', array['uuid','uuid','timestamptz','timestamptz','timestamptz','integer']);
select has_function('public', 'get_sidebar_activity', array['uuid']);
select has_function('public', 'get_all_communities', array['uuid']);
select has_function('public', 'get_thread_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_event_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_resource_list_aggregates', array['uuid','uuid[]']);
select has_function('public', 'get_showcase_list_page', array['uuid','uuid','timestamptz','uuid','integer']);

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

select ok(
  not exists(
    select 1
    from public.communities community
    where community.member_count <> (
      select count(*)::bigint
      from public.community_members member
      where member.community_id = community.id
    )
  ),
  'materialized community member counts match membership rows'
);

select has_index(
  'public',
  'community_members',
  'idx_community_members_user_community',
  'community membership lookup has a user-first covering index'
);

select has_index(
  'public',
  'communities',
  'idx_communities_active_name',
  'active communities have a partial ordering index'
);

create temporary table rpc_count_trigger_context as
select id as community_id, member_count
from public.communities
order by member_count desc, id
limit 1;

create temporary table rpc_inserted_membership as
with inserted as (
  insert into public.community_members (community_id, user_id)
  select context.community_id, gen_random_uuid()
  from rpc_count_trigger_context context
  returning community_id, user_id
)
select * from inserted;

select is(
  (select community.member_count
   from public.communities community
   join rpc_count_trigger_context context on context.community_id = community.id),
  (select member_count + 1 from rpc_count_trigger_context),
  'inserting a membership increments the materialized count'
);

delete from public.community_members member
using rpc_inserted_membership inserted
where member.community_id = inserted.community_id
  and member.user_id = inserted.user_id;

select is(
  (select community.member_count
   from public.communities community
   join rpc_count_trigger_context context on context.community_id = community.id),
  (select member_count from rpc_count_trigger_context),
  'deleting a membership decrements the materialized count'
);

select * from finish();
rollback;
