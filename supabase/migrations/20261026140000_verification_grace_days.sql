-- ============================================================
-- Verification grace window
--
-- New signups can explore for N days before the read-only notice and
-- write restrictions begin. The window is measured from users.created_at.
-- `0` keeps the current behaviour (verification applies immediately).
--
-- One singleton row; service-role only, like the other verification tables.
-- ============================================================

create table if not exists public.verification_settings (
  id boolean primary key default true check (id),
  grace_days integer not null default 0 check (grace_days between 0 and 30),
  updated_at timestamptz not null default now()
);

alter table public.verification_settings enable row level security;

insert into public.verification_settings (id, grace_days)
values (true, 0)
on conflict (id) do nothing;

comment on table public.verification_settings is
  'Singleton verification policy. grace_days delays the banner and write gate for new signups.';
