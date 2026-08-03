-- Allow community members to mark their threads, events, and resources as
-- publicly visible on the home feed for all logged-in users.

alter table community_threads
  add column if not exists is_public boolean not null default false;

alter table community_events
  add column if not exists is_public boolean not null default false;

alter table community_resources
  add column if not exists is_public boolean not null default false;

comment on column community_threads.is_public   is 'When true, any logged-in user can view this thread and comment on it.';
comment on column community_events.is_public    is 'When true, any logged-in user can view this event and comment on it.';
comment on column community_resources.is_public is 'When true, any logged-in user can view this resource and comment on it.';
