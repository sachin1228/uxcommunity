-- Eligibility and consent records captured at signup.
--
-- Both timestamps are set by /api/signup/avatar immediately after the account
-- is created. Existing accounts keep NULL: consent cannot be back-dated for
-- people who were never shown the notice. New accounts always carry both.
alter table public.users
  add column if not exists age_confirmed_at timestamptz,
  add column if not exists terms_accepted_at timestamptz;

comment on column public.users.age_confirmed_at is
  'When the member confirmed at signup that they are 18 or older.';
comment on column public.users.terms_accepted_at is
  'When the member accepted the Terms of Service, Community Guidelines and Privacy Policy.';
