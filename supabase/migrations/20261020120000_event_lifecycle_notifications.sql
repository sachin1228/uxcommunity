-- ============================================================
-- Event lifecycle notifications
--
-- WHY
--   Going to an event is a promise with a clock: the reminder the day before,
--   the morning-of nudge, the half-hour call, the moment it goes live and the
--   note that it has ended. Until now the only event notifications were social
--   (someone RSVPed, commented), so a member who is going had to remember the
--   time themselves. The realtime Worker's every-minute cron drives these
--   (src/event-notifications.ts), and the web endpoint writes both the in-app
--   row and the Expo push.
--
-- WHAT
--   1. Three notification types: event_reminder (tomorrow / today / soon),
--      event_live, event_ended. The existing type list is rebuilt in full,
--      including join_request_accepted, which the accept route has been writing
--      since 20261012150000 but was never added to the check (an unread notice
--      that silently failed to insert).
--   2. event_notification_deliveries — the once-per-member-per-stage ledger.
--      A cron tick that overlaps another (or a retried invocation) cannot send
--      the same stage twice; a member who RSVPs after a stage has passed simply
--      has no row for it and still receives the later stages.
--   3. Two indexes: the cron scans events by start and by end, not by
--      community, so the existing per-community indexes do not help it.
--
-- Deploy note: the release that starts calling these must not go out
-- before this SQL is applied. Apply it from the SQL editor first.
-- ============================================================

-- ─── 1. Notification types ──────────────────────────────────
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
      'job_match',
      'join_request_accepted',
      'event_reminder',
      'event_live',
      'event_ended'
    )
  );

-- ─── 2. The delivery ledger ─────────────────────────────────
-- One row per (event, stage, member), written as a claim before anything is
-- sent. `stage` is the lifecycle moment, not the notification type: tomorrow,
-- today and soon all ride the event_reminder type but each may be sent once.
create table if not exists public.event_notification_deliveries (
  event_id  uuid not null references public.community_events (id) on delete cascade,
  user_id   uuid not null references public.users (id) on delete cascade,
  stage     text not null check (stage in ('tomorrow', 'today', 'soon', 'live', 'ended')),
  sent_at   timestamptz not null default now(),
  primary key (event_id, user_id, stage)
);

alter table public.event_notification_deliveries enable row level security;

-- Server-only ledger: no reads or writes from anon/authenticated. The cron's
-- endpoint uses the service role, which bypasses RLS.
revoke all on table public.event_notification_deliveries from anon, authenticated;

comment on table public.event_notification_deliveries is
  'Once-per-member-per-stage ledger for event lifecycle notifications, claimed before sending so overlapping cron ticks cannot double-notify.';

-- ─── 3. The cron's scan indexes ─────────────────────────────
create index if not exists idx_community_events_lifecycle_start
  on public.community_events (event_date);

create index if not exists idx_community_events_lifecycle_end
  on public.community_events (end_date)
  where end_date is not null;
