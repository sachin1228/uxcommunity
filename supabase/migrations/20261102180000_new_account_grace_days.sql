-- New signups get their own write grace window. grace_days stays the legacy
-- admin value kept for older clients; it does not gate writes. Carry the
-- currently displayed window over so enforcement does not silently drop to 0.
alter table public.verification_settings
  add column if not exists new_account_grace_days integer;

update public.verification_settings
  set new_account_grace_days = grace_days
  where new_account_grace_days is null;

alter table public.verification_settings
  alter column new_account_grace_days set default 0,
  alter column new_account_grace_days set not null;

alter table public.verification_settings
  add constraint verification_settings_new_account_grace_days_check
  check (new_account_grace_days >= 0 and new_account_grace_days <= 30);

comment on column public.verification_settings.new_account_grace_days is
  'Days after users.created_at a non-approved account may write. 0 gates at signup.';

comment on table public.verification_settings is
  'Singleton verification policy. new_account_grace_days delays the banner and write gate for new signups; grace_days is the legacy admin value.';
