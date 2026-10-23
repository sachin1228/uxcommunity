-- ============================================================
-- Raw FCM tokens for Android chat pushes
--
-- Android chat messages are sent directly to FCM as data-only messages so the
-- app can draw the WhatsApp-style notification (community DP on the left)
-- itself. Expo's push service cannot deliver that layout: background
-- notifications sent through Expo are rendered by FCM's system builder.
--
-- Devices keep their Expo token too — iOS and non-chat pushes still use it.
-- Service-role only: the API writes this table, no client reads it.
-- ============================================================

create table if not exists public.fcm_tokens (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists idx_fcm_tokens_user
  on public.fcm_tokens (user_id);

alter table public.fcm_tokens enable row level security;

comment on table public.fcm_tokens is
  'Raw Android FCM tokens (data-only chat pushes). Server-side only; Expo tokens remain in push_tokens for iOS and notification-list pushes.';
