-- ============================================================
-- Preserve appeal history after account/report deletion
--
-- An appeal is part of the moderation record. The original FKs cascaded, so
-- deleting the moderated account (or a report) erased its appeals. Make the
-- subject/report references historical and nullable, record when the subject
-- was erased, and extend the reporter-anonymization trigger to do the same
-- update in the account-deletion transaction.
-- ============================================================

alter table public.moderation_appeals
  add column if not exists user_deleted_at timestamptz,
  add column if not exists report_deleted_at timestamptz;

alter table public.moderation_appeals
  alter column user_id drop not null;
alter table public.moderation_appeals
  alter column report_id drop not null;

alter table public.moderation_appeals
  drop constraint if exists moderation_appeals_user_id_fkey;
alter table public.moderation_appeals
  add constraint moderation_appeals_user_id_fkey
  foreign key (user_id) references public.users (id) on delete set null;

alter table public.moderation_appeals
  drop constraint if exists moderation_appeals_report_id_fkey;
alter table public.moderation_appeals
  add constraint moderation_appeals_report_id_fkey
  foreign key (report_id) references public.interaction_reports (id) on delete set null;

comment on column public.moderation_appeals.user_deleted_at is
  'When the appealing account was erased. The appeal and its audit trail are retained.';

create or replace function public.anonymize_deleted_user_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.interaction_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.content_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.dm_reports
     set reporter_id = null,
         reporter_deleted_at = coalesce(reporter_deleted_at, now())
   where reporter_id = old.id;

  update public.moderation_appeals
     set user_id = null,
         user_deleted_at = coalesce(user_deleted_at, now())
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.anonymize_deleted_user_reports() from public, anon, authenticated;
grant execute on function public.anonymize_deleted_user_reports() to service_role;

notify pgrst, 'reload schema';
