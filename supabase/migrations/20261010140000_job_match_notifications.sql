-- ============================================================
-- Job-match notifications
--
-- WHY
--   A member who posts a role wants the members it fits to hear about
--   it — and a member watching the board wants to be told, not to
--   re-poll the tabs. Posting now fans one notification out to every
--   profile the posting matches, with the row linking to the role
--   (the API route does the fan-out with the same eligibility the
--   write enforces: job title and experience level exactly, city and
--   sector unless the posting set them to All — migration
--   20261010130000_job_wildcard_criteria.sql).
--
-- WHAT
--   Two CHECK rebuilds, nothing else:
--
--   • notifications_type_check gains 'job_match' — a role matching
--     the recipient's profile was posted.
--   • notifications_entity_type_check gains 'job' — the entity is
--     the posting itself, so the unread-dedupe identity
--     (user_id, entity_type, entity_id) folds repeat events on one
--     posting into a single unread row, like every other entity.
--
-- Deploy note: constraint-only, no data rewrite; every existing row
-- still satisfies both checks. The type list below is the latest
-- rebuild (20261005140000_report_review_and_undo.sql) plus the new
-- value.
-- ============================================================

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'thread_comment',
      'thread_reply',
      'thread_like',
      'resource_comment',
      'resource_reply',
      'event_comment',
      'event_reply',
      'event_rsvp',
      'thread_deleted',
      'showcase_deleted',
      'resource_deleted',
      'event_deleted',
      'report_reviewed',
      'content_restored',
      'job_match'
    )
  );

alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in ('community', 'thread', 'resource', 'event', 'message', 'showcase', 'job')
  );
