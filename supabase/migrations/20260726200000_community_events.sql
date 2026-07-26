-- ============================================================
-- Community events + RSVPs
-- ============================================================

create table if not exists community_events (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  title          varchar(120) not null check (char_length(title) between 1 and 120),
  description    text check (description is null or char_length(description) <= 5000),
  event_date     timestamptz not null,
  end_date       timestamptz check (end_date is null or end_date > event_date),
  is_online      boolean not null default false,
  location       text check (location is null or char_length(location) <= 500),
  meet_link      text check (meet_link is null or char_length(meet_link) <= 2048),
  max_attendees  integer check (max_attendees is null or max_attendees > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_community_events_community_date
  on community_events (community_id, event_date asc);

create index if not exists idx_community_events_user
  on community_events (user_id);

create or replace trigger trg_community_events_updated_at
  before update on community_events
  for each row execute function set_updated_at();

alter table community_events enable row level security;

create policy "public_read" on community_events
  for select using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_events'
  ) then
    alter publication supabase_realtime add table community_events;
  end if;
end $$;

alter table community_events replica identity full;

-- ── RSVPs ────────────────────────────────────────────────────
create table if not exists event_rsvps (
  event_id   uuid not null references community_events (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists idx_event_rsvps_event
  on event_rsvps (event_id);

alter table event_rsvps enable row level security;

create policy "public_read" on event_rsvps
  for select using (true);
