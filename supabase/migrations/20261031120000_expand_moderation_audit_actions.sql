-- ============================================================
-- Cover every moderator action in the append-only audit log
--
-- The original check only listed the interaction-report actions. Direct admin
-- block/unblock, user deletion, content-report dismiss/reopen/restore, DM
-- report review/reopen, and community/job admin toggles also change account or
-- content state, so they must be auditable too.
-- ============================================================

alter table public.moderation_audit_log
  drop constraint if exists moderation_audit_log_action_check;

alter table public.moderation_audit_log
  add constraint moderation_audit_log_action_check check (
    action in (
      'dismiss_report',
      'remove_content',
      'restore_content',
      'reopen_report',
      'hide_community',
      'deactivate_job',
      'warn_user',
      'suspend_user',
      'ban_user',
      'unban_user',
      'lift_suspension',
      'grant_appeal',
      'deny_appeal',
      'delete_user',
      'review_dm_report',
      'reopen_dm_report',
      'toggle_community',
      'delete_community',
      'toggle_job',
      'delete_job',
      'delete_event',
      'review_verification'
    )
  );

notify pgrst, 'reload schema';
