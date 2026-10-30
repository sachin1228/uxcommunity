-- An appeal is part of the moderation record; deleting the moderated account
-- must anonymize it, not cascade it away.
begin;
create extension if not exists pgtap;
select plan(5);

insert into public.interaction_reports
  (reporter_id, target_type, target_id, context_id, target_author_id,
   target_author_name, target_excerpt, context_title, target_snapshot,
   reason, details, status)
values
  ('11111111-1111-1111-1111-111111111111', 'profile',
   '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111', 'Viewer', 'Profile evidence',
   'Profile of Viewer', '{"kind":"profile"}'::jsonb, 'other', 'Test appeal', 'removed');

insert into public.moderation_appeals
  (report_id, user_id, target_type, target_id, message)
select id, '11111111-1111-1111-1111-111111111111', 'profile',
       '11111111-1111-1111-1111-111111111111',
       'This appeal is long enough to be accepted by the database.'
from public.interaction_reports
where target_type = 'profile'
  and target_author_name = 'Viewer'
order by created_at desc limit 1;

select is((select count(*)::integer from public.moderation_appeals), 1,
  'the appeal exists before account deletion');
select is((select user_id from public.moderation_appeals limit 1),
          '11111111-1111-1111-1111-111111111111'::uuid,
  'the appeal is linked to the moderated account');
select is((select reporter_id from public.interaction_reports
           where target_author_name = 'Viewer' limit 1),
          '11111111-1111-1111-1111-111111111111'::uuid,
  'the report still has its reporter before deletion');

delete from public.users where id = '11111111-1111-1111-1111-111111111111';

select is((select count(*)::integer from public.moderation_appeals), 1,
  'the appeal survives account deletion');
select is(
  (select user_id is null and user_deleted_at is not null
   from public.moderation_appeals limit 1),
  true,
  'the appeal is anonymized and stamped with the deletion time'
);

select * from finish();
rollback;
