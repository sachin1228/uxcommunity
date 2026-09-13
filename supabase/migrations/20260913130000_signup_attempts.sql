-- ============================================================
-- Signup attempts: emails that entered step 1 but never finished
--
-- Signup is intentionally not persisted until the final step (the
-- complete_signup RPC creates the account), so there was no way to see who
-- dropped off. Each step-1 request (direct or invitation) now upserts a row
-- here; finalization flips it to 'completed'. The admin "Incomplete Signups"
-- view lists the rows still in 'started'.
--
-- RLS is enabled with NO policies: only the service role (all app routes) can
-- read or write, since this table holds emails of people who never signed up.
-- ============================================================

create table if not exists public.signup_attempts (
  id             uuid primary key default gen_random_uuid(),
  -- One row per email — repeat attempts refresh started_at instead of piling up.
  email          text not null unique,
  name           text,
  -- Which entry point they used: open signup or an invitation link.
  flow           text not null default 'direct'
                 check (flow in ('direct', 'invitation')),
  -- Set for invitation signups so the admin can trace back to the application.
  application_id uuid references public.applications (id) on delete set null,
  status         text not null default 'started'
                 check (status in ('started', 'completed')),
  -- Set when the account is created.
  user_id        uuid references public.users (id) on delete set null,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists idx_signup_attempts_status_started
  on public.signup_attempts (status, started_at desc);

alter table public.signup_attempts enable row level security;
-- No policies on purpose — service role only.
