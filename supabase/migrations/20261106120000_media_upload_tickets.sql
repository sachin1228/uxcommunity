-- Server-side ownership and one-time state for direct-to-R2 showcase videos.
--
-- The ticket route binds a media id to the member and community that requested
-- it. The completion route can then reject a finalize request from another
-- member (or a reused ticket) before it trusts any client-reported metadata;
-- the actual object size/type is verified with an R2 HEAD.

create table if not exists public.media_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null unique,
  user_id uuid not null references users(id) on delete cascade,
  community_id uuid not null references communities(id) on delete cascade,
  staging_key text not null unique,
  poster_staging_key text,
  content_type text not null,
  expected_size bigint not null check (expected_size > 0),
  expires_at timestamp with time zone not null,
  finalized_at timestamp with time zone,
  rejected_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create index if not exists media_upload_tickets_user_idx
  on public.media_upload_tickets (user_id, created_at desc);

create index if not exists media_upload_tickets_community_idx
  on public.media_upload_tickets (community_id, created_at desc);

create index if not exists media_upload_tickets_expiry_idx
  on public.media_upload_tickets (expires_at)
  where finalized_at is null and rejected_at is null;

alter table public.media_upload_tickets enable row level security;
revoke all on table public.media_upload_tickets from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.media_upload_tickets to service_role;

comment on table public.media_upload_tickets is
  'One row per direct-to-R2 showcase upload ticket: binds media_id to the requesting member/community, enforces a single finalize, and records rejection so a failed HEAD/size/type check cannot be retried as a different upload.';
