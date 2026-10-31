-- Signup consent is written in the same transaction as the account, and false
-- acknowledgements cannot create an account.
begin;
create extension if not exists pgtap;
select plan(3);

insert into public.cities (id, name) values
  ('00000000-0000-0000-0000-0000000000c1', 'Consent Test City')
on conflict (name) do nothing;
insert into public.design_sectors (id, name) values
  ('00000000-0000-0000-0000-0000000000c2', 'Consent Test Sector')
on conflict (name) do nothing;

select throws_ok(
  $$select * from public.complete_signup_with_consent(
      'Consent Tester', 'consent-fail@example.test', 'x',
      '00000000-0000-0000-0000-0000000000c1',
      '00000000-0000-0000-0000-0000000000c2',
      'student', 'product_designer', null, null,
      false, true, '2026-10-30'
    )$$,
  'P0001',
  'consent_required',
  'false age confirmation refuses account creation'
);

select is(
  (select count(*)::integer from public.complete_signup_with_consent(
      'Consent Tester', 'consent-ok@example.test', 'x',
      '00000000-0000-0000-0000-0000000000c1',
      '00000000-0000-0000-0000-0000000000c2',
      'student', 'product_designer', null, null,
      true, true, '2026-10-30'
  )),
  1,
  'valid consent creates exactly one account'
);

select is(
  (select terms_accepted_at is not null
          and age_confirmed_at is not null
          and terms_version = '2026-10-30'
     from public.users where email = 'consent-ok@example.test'),
  true,
  'consent timestamps and version are persisted'
);

select * from finish();
rollback;
