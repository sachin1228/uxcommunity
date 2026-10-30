-- Guards the forward-only fixes that a fresh database needs.
begin;
create extension if not exists pgtap;
select plan(9);

select has_function('public', 'get_resource_list_aggregates', 'resource aggregate RPC exists');
select is(
  (select pg_get_function_result('public.get_resource_list_aggregates(uuid,uuid[])'::regprocedure)
          like '%allow_replies%'),
  true,
  'resource aggregate RPC returns allow_replies'
);
select has_column('public', 'community_resources', 'allow_replies', 'resource allow_replies column exists');
select has_function('public', 'complete_signup_with_consent', 'atomic signup consent RPC exists');
select has_column('public', 'users', 'terms_version', 'versioned consent column exists');
select has_function('public', 'apply_to_job_with_resume', 'transactional resume apply RPC exists');
select has_column('public', 'content_reports', 'target_snapshot', 'content report evidence snapshot exists');
select has_column('public', 'moderation_appeals', 'user_deleted_at', 'appeal retention column exists');
select is(
  (select pg_get_constraintdef(oid) like '%delete_user%'
          and pg_get_constraintdef(oid) like '%review_dm_report%'
          and pg_get_constraintdef(oid) like '%toggle_community%'
   from pg_constraint
   where conrelid = 'public.moderation_audit_log'::regclass
     and conname = 'moderation_audit_log_action_check'),
  true,
  'moderation audit action check covers the added admin actions'
);

select * from finish();
rollback;
