begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into public.creation_limits(kind,limit_count,period) values ('community_joins',2,'total')
on conflict(kind) do update set limit_count=2;
insert into public.users(id,name,email,password_hash)
select ('af100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'Backfill fixture', 'backfill-'||n||'@test.invalid', 'hash' from generate_series(1,4) n;
insert into public.cities(id,name) values
 ('af200000-0000-4000-8000-000000000001','Login Backfill City'),
 ('af200000-0000-4000-8000-000000000002',' Other ');
insert into public.design_sectors(id,name) values ('af300000-0000-4000-8000-000000000001','Login Backfill Sector');
insert into public.designer_profiles(user_id,city_id,sector_id,experience_level,communities_auto_joined)
select id,
 case when email='backfill-3@test.invalid' then 'af200000-0000-4000-8000-000000000002' else 'af200000-0000-4000-8000-000000000001' end::uuid,
 case when email='backfill-3@test.invalid' then null else 'af300000-0000-4000-8000-000000000001' end::uuid,
 'missing-fixture-level', email='backfill-2@test.invalid'
from public.users where id::text like 'af100000-%';
insert into public.communities(id,type,reference_id,name) values
 ('af400000-0000-4000-8000-000000000001','city','af200000-0000-4000-8000-000000000001','Login Backfill City Designers'),
 ('af400000-0000-4000-8000-000000000002','city','af200000-0000-4000-8000-000000000003','Existing slot one'),
 ('af400000-0000-4000-8000-000000000003','city','af200000-0000-4000-8000-000000000004','Existing slot two');
insert into public.community_members(community_id,user_id) values
 ('af400000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001'),
 ('af400000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000004'),
 ('af400000-0000-4000-8000-000000000003','af100000-0000-4000-8000-000000000004');

-- Re-run the actual migration over legacy fixtures, inside this rollback.
\ir ../migrations/20261104001500_login_dashboard_performance.sql

select is(public.count_join_slots('af100000-0000-4000-8000-000000000001'),2,'fills missing memberships without double-counting existing ones');
select is((select count(*)::integer from public.community_members where user_id='af100000-0000-4000-8000-000000000001' and community_id='af400000-0000-4000-8000-000000000001'),1,'existing membership is retained');
select is(public.count_join_slots('af100000-0000-4000-8000-000000000002'),0,'processed profile is not rejoined');
select is(public.count_join_slots('af100000-0000-4000-8000-000000000003'),0,'Other and unresolved options do not create memberships');
select is((select count(*)::integer from public.communities where reference_id='af200000-0000-4000-8000-000000000002'),0,'Other does not create a community');
select is(public.count_join_slots('af100000-0000-4000-8000-000000000004'),2,'a full account stays within the live cap');
select is((select count(*)::integer from public.designer_profiles where user_id::text like 'af100000-%' and communities_auto_joined),4,'processed, Other and cap-limited profiles are marked complete');
delete from public.community_members where user_id='af100000-0000-4000-8000-000000000001' and community_id='af400000-0000-4000-8000-000000000001';
\ir ../migrations/20261104001500_login_dashboard_performance.sql
select is(public.count_join_slots('af100000-0000-4000-8000-000000000001'),1,'rerunning never reverses an intentional leave');
select is(public.count_join_slots('af100000-0000-4000-8000-000000000004'),2,'rerunning preserves the full account');
select * from finish();
rollback;
