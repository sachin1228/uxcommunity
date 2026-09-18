-- ============================================================
-- Push tokens
--
-- Expo push tokens, one row per device, so the server can wake a
-- member's phone when a chat message arrives. Realtime only reaches
-- an app that is running; once the OS suspends it the socket dies,
-- so background delivery has to go through Expo's push service.
--
-- Token is the primary key: the same device can be handed to a
-- different account (logout → login), and Expo tokens are unique per
-- install, so an upsert on `token` re-points it at the current user
-- instead of leaving a stale row that would push to the wrong person.
--
-- Written and read only by the API routes through the service-role
-- client, so RLS is on with no policies: anon/authenticated can never
-- read the table (which would otherwise leak every member's devices).
-- ============================================================

create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_tokens_user_id_idx
  on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

revoke all on table public.push_tokens from anon, authenticated;
