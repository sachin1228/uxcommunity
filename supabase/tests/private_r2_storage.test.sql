-- Static checks for the private R2 storage migration
-- (20261030200000_private_r2_storage.sql).
--
-- Run locally after the migration:
--   bash supabase/tests/run-local.sh supabase/tests/private_r2_storage.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column('public', 'member_resumes', 'storage_key', 'saved résumés carry a private object key');
select has_column('public', 'job_applications', 'resume_key', 'applications carry a private object key');
select has_column('public', 'account_verification_requests', 'work_sample_keys', 'verification samples carry private keys');
select has_column('public', 'dm_messages', 'image_key', 'DM images carry a private object key');

select col_is_null('public', 'member_resumes', 'url', 'the legacy resume URL is nullable after the migration');

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'member_resumes_storage_key_shape'
      and pg_get_constraintdef(oid) like '%resumes/%'
  ),
  'resume keys are constrained to the private namespace'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'dm_messages_payload_present'
      and pg_get_constraintdef(oid) like '%image_key%'
  ),
  'a DM row may be carried by its private key alone'
);

select ok(
  pg_get_functiondef('public.get_job_applicants(uuid,uuid)'::regprocedure) like '%resume_key%'
  and pg_get_functiondef('public.job_post_payload(uuid,uuid)'::regprocedure) like '%resume_key%',
  'both jobs payloads expose the private resume key'
);

select * from finish();
rollback;
