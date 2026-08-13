-- Repair resource comments in environments that missed the historical migration.
-- This migration is intentionally idempotent and safe to run more than once.

create table if not exists public.resource_comments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.community_resources (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  parent_id uuid references public.resource_comments (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Repair constraints when the table existed only partially.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.resource_comments'::regclass
      and conname = 'resource_comments_body_length_check'
  ) then
    alter table public.resource_comments
      add constraint resource_comments_body_length_check
      check (char_length(body) between 1 and 5000) not valid;
    alter table public.resource_comments
      validate constraint resource_comments_body_length_check;
  end if;
end $$;

create index if not exists idx_resource_comments_resource_time
  on public.resource_comments (resource_id, created_at asc);
create index if not exists idx_resource_comments_parent
  on public.resource_comments (parent_id);
create index if not exists idx_resource_comments_user
  on public.resource_comments (user_id);

-- These partial indexes support the three public-feed scans and cursor ordering.
create index if not exists idx_community_threads_public_created
  on public.community_threads (created_at desc) where is_public = true;
create index if not exists idx_community_events_public_created
  on public.community_events (created_at desc) where is_public = true;
create index if not exists idx_community_resources_public_created
  on public.community_resources (created_at desc) where is_public = true;

create or replace trigger trg_resource_comments_updated_at
  before update on public.resource_comments
  for each row execute function public.set_updated_at();

alter table public.resource_comments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'resource_comments'
      and policyname = 'public_read'
  ) then
    create policy public_read on public.resource_comments
      for select to anon, authenticated using (true);
  end if;
end $$;

grant select on table public.resource_comments to anon, authenticated;

-- Writes remain server-authorized through application API routes. No direct
-- INSERT/UPDATE/DELETE grants or permissive write policies are added here.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'resource_comments'
  ) then
    alter publication supabase_realtime add table public.resource_comments;
  end if;
end $$;

alter table public.resource_comments replica identity full;
