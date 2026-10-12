-- Explore page: the pending private-community join request must survive a
-- reload, which means get_all_communities has to report it.
--
-- The column shipped with the request flow (20260830000000) but was dropped by
-- a later recreation of the function, so the Explore card's "Request sent"
-- state silently disappeared after a refresh. 20261012140000_explore_pending_join_request
-- restores it. These two assertions lock both halves in place: the returns-table
-- column exists, and it is true only for the requester's own pending row.

begin;
select plan(2);

select is(
  (select 'has_pending_request' = any(p.proargnames)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_all_communities'),
  true,
  'get_all_communities returns has_pending_request'
);

insert into public.communities (id, name, type, is_active, member_count, is_private, owner_id)
values ('eeeeeeee-0000-0000-0000-00000000000e', 'Private Fixture', 'user', true, 1, true,
        '22222222-2222-2222-2222-222222222222')
on conflict (id) do update set is_private = true, member_count = 1, is_active = true;

-- The owner is a member (so the community is listed); the viewer is not.
insert into public.community_members (community_id, user_id) values
  ('eeeeeeee-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222')
on conflict do nothing;

insert into public.community_join_requests (community_id, user_id, status) values
  ('eeeeeeee-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'pending')
on conflict (community_id, user_id) do update set status = 'pending';

select is(
  (select count(*) from public.get_all_communities('11111111-1111-1111-1111-111111111111')
   where id = 'eeeeeeee-0000-0000-0000-00000000000e' and has_pending_request = true),
  1::bigint,
  'the requester''s row reports a pending request'
);

select * from public.finish();
rollback;
