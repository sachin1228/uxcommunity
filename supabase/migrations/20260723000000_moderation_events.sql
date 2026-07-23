create type moderation_status as enum ('approved', 'review', 'rejected');

create type moderation_content_type as enum (
  'chat_message',
  'post',
  'comment',
  'username',
  'user_bio',
  'community_name',
  'image_upload'
);

create table if not exists moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  content_type moderation_content_type not null,
  content_ref_id uuid,
  content_hash text,
  status moderation_status not null,
  reason text,
  provider text not null,
  confidence numeric not null default 0,
  triggered_rules jsonb not null default '[]'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  duration_ms integer not null default 0,
  moderator_notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_moderation_events_status_created_at
  on moderation_events (status, created_at desc);

create index if not exists idx_moderation_events_user_created_at
  on moderation_events (user_id, created_at desc);

create index if not exists idx_moderation_events_content_type_created_at
  on moderation_events (content_type, created_at desc);

alter table moderation_events enable row level security;
