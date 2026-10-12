-- The accepted-join-request push has its own switch, separate from the chat
-- master switch. The sender (`lib/push/membership.ts`), the settings loader and
-- `/api/push/settings` all read `community_push_enabled`, and a member who has
-- never opened settings must still receive updates — so the column must exist,
-- be a non-null boolean, and default on.

begin;
select plan(3);

select is(
  (select data_type from information_schema.columns
   where table_schema = 'public'
     and table_name = 'notification_preferences'
     and column_name = 'community_push_enabled'),
  'boolean',
  'community_push_enabled is a boolean column'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public'
     and table_name = 'notification_preferences'
     and column_name = 'community_push_enabled'),
  'NO',
  'community_push_enabled is not nullable'
);

select is(
  (select column_default is not null from information_schema.columns
   where table_schema = 'public'
     and table_name = 'notification_preferences'
     and column_name = 'community_push_enabled'),
  true,
  'community_push_enabled has a default (so existing rows read as on)'
);

select * from public.finish();
rollback;
