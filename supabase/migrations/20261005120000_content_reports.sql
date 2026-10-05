-- ============================================================
-- Content reports
--
-- Members can flag a community thread, showcase post, resource or event
-- through the in-app report modal. Rows land as `pending` and are reviewed
-- from the admin dashboard, which either removes the content or dismisses
-- the report. Both the reporter and the author are notified when the
-- content comes down (the report_reviewed type below and the existing
-- *_deleted types respectively).
--
-- Snapshots (`content_author_id`, `content_title`) are stored at report time
-- so the admin list still reads after the content row is gone — a report
-- outlives the post it points at.
-- ============================================================

create table if not exists public.content_reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.users (id) on delete cascade,
  content_type      text not null check (
    content_type in ('thread', 'showcase', 'resource', 'event')
  ),
  content_id        uuid not null,
  -- Nulled when the community is deleted; the report itself survives.
  community_id      uuid references public.communities (id) on delete set null,
  content_author_id uuid references public.users (id) on delete set null,
  content_title     text,
  reason            text not null check (
    reason in (
      'spam',
      'harassment',
      'hate',
      'misinformation',
      'inappropriate',
      'intellectual_property',
      'off_topic',
      'other'
    )
  ),
  details           text,
  status            text not null default 'pending' check (
    status in ('pending', 'removed', 'dismissed')
  ),
  resolved_at       timestamptz,
  resolved_by       uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_content_reports_status_created
  on public.content_reports (status, created_at desc);

create index if not exists idx_content_reports_content
  on public.content_reports (content_type, content_id);

-- One open report per member per post: a second submission while the first
-- is still pending is rejected by the unique index. Once a report is
-- resolved (removed or dismissed) the member may report the same post again
-- if it comes back — the index only covers pending rows.
create unique index if not exists content_reports_pending_unique
  on public.content_reports (reporter_id, content_type, content_id)
  where status = 'pending';

-- Reads and writes always go through the Next.js API's service-role client.
alter table public.content_reports enable row level security;

-- ─── Reporter notification ──────────────────────────────────────────────────
-- The existing *_deleted types cover the author's removal notice. The
-- reporter gets a distinct thank-you once their report is actioned, so the
-- type list needs one new entry.
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
      'report_reviewed'
    )
  );
