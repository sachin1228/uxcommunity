-- Restore the notification entity type the interaction-report migration
-- dropped.
--
-- 20261030140000_global_blocks_and_interaction_reports.sql rebuilt
-- notifications_entity_type_check to add 'profile' but omitted 'verification',
-- which was added by 20261026130000_account_verification.sql. Verification
-- approval/rejection notifications use entity_type = 'verification', so
-- without this migration those inserts fail the check constraint.
alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in (
      'community',
      'thread',
      'resource',
      'event',
      'message',
      'showcase',
      'job',
      'verification',
      'profile'
    )
  );

notify pgrst, 'reload schema';
