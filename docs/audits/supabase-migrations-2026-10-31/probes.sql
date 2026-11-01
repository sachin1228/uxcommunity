-- Read-only audit SELECTs; captured via Supabase /database/query/read-only.
-- For psql, use a read-only login plus PGOPTIONS=-cdefault_transaction_read_only=on.
-- No application stored routine is invoked by these catalog/probe queries.
select 'meta' category,jsonb_build_object('captured_at',now(),'role',current_user,'read_only',current_setting('transaction_read_only'),'search_path',current_setting('search_path')) data
union all select 'table_privileges',jsonb_agg(jsonb_build_object('table',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'anon_write',has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE'),'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),'authenticated_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'),'service_select',has_table_privilege('service_role',c.oid,'SELECT'),'service_write',has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE')) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')
union all select 'routine_privileges',jsonb_agg(jsonb_build_object('name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
union all select 'database_privileges',jsonb_build_object('owner',pg_get_userbyid(datdba),'acl',datacl::text,'settings',(select jsonb_agg(jsonb_build_object('role',case when setrole=0 then 'ALL' else pg_get_userbyid(setrole) end,'keys',(select jsonb_agg(split_part(x,'=',1)) from unnest(setconfig) x))) from pg_db_role_setting s where s.setdatabase=d.oid)) from pg_database d where datname=current_database()
union all select 'storage_buckets',jsonb_agg(jsonb_build_object('id',id,'public',public) order by id) from storage.buckets where id in ('profile-avatars','master-data-images')
union all select 'data_invariants',jsonb_build_object(
 'duplicate_user_application_groups',(select count(*) from (select application_id from public.users where application_id is not null group by application_id having count(*)>1) d),
 'resource_comments_over_2000',(select count(*) from public.resource_comments where char_length(body)>2000),
 'resource_comments_invalid_1_5000',(select count(*) from public.resource_comments where char_length(body) not between 1 and 5000),
 'general_communities',(select count(*) from public.communities where type='general'),
 'interest_communities',(select count(*) from public.communities where type='interest'),
 'company_communities',(select count(*) from public.communities where type='company'),
 'dangling_event_links',(select count(*) from public.communities c where event_id is not null and not exists(select 1 from public.community_events e where e.id=c.event_id)),
 'events_without_rooms',(select count(*) from public.community_events e where not exists(select 1 from public.communities c where c.event_id=e.id)),
 'orphaned_user_communities',(select count(*) from public.communities where type='user' and owner_id is null),
 'negative_member_counts',(select count(*) from public.communities where member_count<0),
 'member_count_mismatches',(select count(*) from public.communities c where member_count is distinct from (select count(*) from public.community_members m where m.community_id=c.id)),
 'duplicate_notifications',(select count(*) from (select user_id,entity_type,entity_id from public.notifications where read_at is null group by user_id,entity_type,entity_id having count(*)>1) n),
 'missing_host_going',(select count(*) from public.community_events e where not exists(select 1 from public.event_rsvps r where r.event_id=e.id and r.user_id=e.user_id)),
 'inactive_experience_levels',(select count(*) from public.experience_levels where is_active=false),
 'mnc_seed_companies',(select count(*) from public.companies where source='curated-mnc'),
 'design_first_companies',(select count(*) from public.companies where featured_rank is not null)
);
