-- ============================================================
-- Verified companies — work email → domain → company
--
-- Migration under test: 20260929120000_company_verified_domains.sql
--
-- The feature's trust signal is a VERIFIED DOMAIN, never the company name a
-- member typed. This file proves that end to end at the database layer:
--
--   1. the first work email creates the company and its verified domain;
--   2. later colleagues on a verified domain join the same company;
--   3. a domain already verified for one company cannot be taken by another,
--      and an existing company name cannot be re-created under an unrelated
--      domain (the "Google + randomcompany.com" case);
--   4. joining an existing company only works with one of ITS verified
--      domains;
--   5. domains are normalised, unique per company, and a company can hold
--      several;
--   6. memberships are unique per (company_id, user_id), unverified rows are
--      never reported as verified, and the profile pointer is what makes a
--      company appear on the profile;
--   7. the OTP challenge counts attempts, expires, and cannot be replayed;
--   8. leaving a company, and deleting one, clean up the profile pointer
--      without destroying the member's profile.
--
-- The free/personal email list, and the rule that a new company's typed name
-- has to correspond to the domain it proves, are application policy rather than
-- schema, so they are covered by apps/web/lib/companies/domains.test.ts.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(104);

-- ─── Fixture ────────────────────────────────────────────────
-- Committed rows, because the RPCs are SECURITY DEFINER and are called across
-- statements. Cleanup first so a failed earlier run cannot leak into this one:
-- deleting the companies cascades their domains and memberships, and deleting
-- the members cascades their challenges.
delete from public.company_email_verifications where user_id in (
  'c0c0c0c0-0000-4000-8000-000000000001',
  'c0c0c0c0-0000-4000-8000-000000000002',
  'c0c0c0c0-0000-4000-8000-000000000003',
  'c0c0c0c0-0000-4000-8000-000000000004',
  'c0c0c0c0-0000-4000-8000-000000000005',
  'c0c0c0c0-0000-4000-8000-000000000006',
  'c0c0c0c0-0000-4000-8000-000000000007',
  'c0c0c0c0-0000-4000-8000-000000000008'
);
delete from public.designer_profiles where user_id in (
  'c0c0c0c0-0000-4000-8000-000000000001',
  'c0c0c0c0-0000-4000-8000-000000000002',
  'c0c0c0c0-0000-4000-8000-000000000003',
  'c0c0c0c0-0000-4000-8000-000000000004',
  'c0c0c0c0-0000-4000-8000-000000000005',
  'c0c0c0c0-0000-4000-8000-000000000006',
  'c0c0c0c0-0000-4000-8000-000000000007',
  'c0c0c0c0-0000-4000-8000-000000000008'
);
delete from public.users where id in (
  'c0c0c0c0-0000-4000-8000-000000000001',
  'c0c0c0c0-0000-4000-8000-000000000002',
  'c0c0c0c0-0000-4000-8000-000000000003',
  'c0c0c0c0-0000-4000-8000-000000000004',
  'c0c0c0c0-0000-4000-8000-000000000005',
  'c0c0c0c0-0000-4000-8000-000000000006',
  'c0c0c0c0-0000-4000-8000-000000000007',
  'c0c0c0c0-0000-4000-8000-000000000008'
);
delete from public.companies where slug in ('figma', 'google', 'midlevel', 'stale-co', 'hintco', 'reserved-co');

insert into public.users (id, name, email, password_hash, application_id) values
  ('c0c0c0c0-0000-4000-8000-000000000001', 'Sachin', 'sachin@figma.test',      'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000002', 'Priya',  'priya@figma.test',       'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000003', 'Raj',    'raj@randomcompany.test', 'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000004', 'Meera',  'meera@somecorp.test',    'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000005', 'Arjun',  'arjun@google.test',      'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000006', 'Dev',    'dev@midlevel.test',      'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000007', 'Asha',   'asha@hintco.test',       'x', null),
  ('c0c0c0c0-0000-4000-8000-000000000008', 'Vikram', 'vikram@reserved.test',   'x', null);

insert into public.designer_profiles (user_id, experience_level)
select id, 'mid_level' from public.users
where id in (
  'c0c0c0c0-0000-4000-8000-000000000001',
  'c0c0c0c0-0000-4000-8000-000000000002',
  'c0c0c0c0-0000-4000-8000-000000000003',
  'c0c0c0c0-0000-4000-8000-000000000004',
  'c0c0c0c0-0000-4000-8000-000000000005',
  'c0c0c0c0-0000-4000-8000-000000000006',
  'c0c0c0c0-0000-4000-8000-000000000007',
  'c0c0c0c0-0000-4000-8000-000000000008'
)
on conflict (user_id) do update set experience_level = excluded.experience_level;


-- ─── 1. Shape of the model ──────────────────────────────────

select has_function('public', 'search_companies', 'search_companies(query, limit) exists');
select has_function('public', 'get_user_company', 'get_user_company(user) exists');
select has_function('public', 'confirm_company_verification', 'confirm_company_verification(...) exists');
select has_index('public', 'company_domains', 'company_domains_verified_domain_idx',
  'the verified-domain unique index exists');
select has_index('public', 'company_members', 'company_members_company_user_key',
  'company_members is unique per (company_id, user_id)');


-- ─── 2. The first member creates the company ────────────────

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000001',
    (select verification_id from public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000001',
      p_domain       => 'figma.test',
      p_work_email   => 'sachin@figma.test',
      p_code_hash    => 'hash-sachin',
      p_company_name => 'Figma'
    )),
    'hash-sachin'
  )),
  'verified',
  'the first work email creates the company and verifies the domain'
);

select is(
  (select c.slug from public.companies as c where c.name = 'Figma'),
  'figma',
  'the created company gets a slug from its name'
);

select is(
  (select count(*)::int from public.company_domains as d
    join public.companies as c on c.id = d.company_id
   where c.name = 'Figma' and d.domain = 'figma.test'
     and d.verified and d.verified_at is not null),
  1,
  'figma.test is stored as a verified domain with a verification timestamp'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.name = 'Figma' and m.verified
     and m.user_id = 'c0c0c0c0-0000-4000-8000-000000000001'),
  1,
  'the founding member has a verified membership'
);

select is(
  (select dp.company_id from public.designer_profiles as dp
   where dp.user_id = 'c0c0c0c0-0000-4000-8000-000000000001'),
  (select id from public.companies where name = 'Figma'),
  'the profile points at the verified company'
);

select is(
  (select name from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000001')),
  'Figma',
  'get_user_company returns the company shown on the profile'
);

select is(
  (select domain from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000001')),
  'figma.test',
  'get_user_company returns the verified domain'
);

select is(
  (select membership_verified from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000001')),
  true,
  'the founding membership is reported as verified'
);


-- ─── 3. Colleagues join the same company ────────────────────

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000002',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000002',
      p_domain     => 'figma.test',
      p_work_email => 'priya@figma.test',
      p_code_hash  => 'hash-priya',
      p_company_id => (select id from public.companies where name = 'Figma')
    )),
    'hash-priya'
  )),
  'verified',
  'a second member on the verified domain joins the same company'
);

-- The same member creating instead of joining is refused: figma.test is
-- already Figma's, so the domain sends them to the existing company.
select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000002',
      p_domain       => 'figma.test',
      p_work_email   => 'priya@figma.test',
      p_code_hash    => 'hash-priya',
      p_company_name => 'Priya Studio'
    )$$,
  'P0001',
  'domain-already-verified-2',
  'a verified domain cannot be re-created as a new company'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.slug = 'figma' and m.verified),
  2,
  'the second member joins Figma'
);

select is(
  (select count(*)::int from public.companies where lower(name) = 'figma'),
  1,
  'no duplicate company was created for the second member'
);


-- ─── 4. The domain is the trust signal ──────────────────────

-- Meera proves meera@figma.test but tries to file it under her own company
-- name. The domain is already Figma's, so the typed name loses.
select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000004',
      p_domain       => 'figma.test',
      p_work_email   => 'meera@figma.test',
      p_code_hash    => 'hash-meera',
      p_company_name => 'Meera Design Co'
    )$$,
  'P0001',
  'domain-already-verified',
  'creating a company on a domain another company verified is refused'
);

select is(
  (select count(*)::int from public.companies where lower(name) = 'meera design co'),
  0,
  'the refused attempt created no company'
);

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000005',
    (select verification_id from public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000005',
      p_domain       => 'google.test',
      p_work_email   => 'arjun@google.test',
      p_code_hash    => 'hash-arjun',
      p_company_name => 'Google'
    )),
    'hash-arjun'
  )),
  'verified',
  'a first Google work email creates Google'
);

-- Raj works at Random Works. Selecting Google must not let him into Google:
-- google.test is not one of his domain's verified companies.
select throws_ok(
  $$select public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000003',
      p_domain     => 'randomcompany.test',
      p_work_email => 'raj@randomcompany.test',
      p_code_hash  => 'hash-raj',
      p_company_id => (select id from public.companies where name = 'Google')
    )$$,
  'P0001',
  'domain-not-verified-for-company',
  'Google + randomcompany.test cannot join Google'
);

-- The same impersonation through the create path is refused as well: an
-- existing company name is joined, never re-created under another domain.
select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000003',
      p_domain       => 'randomcompany.test',
      p_work_email   => 'raj@randomcompany.test',
      p_code_hash    => 'hash-raj',
      p_company_name => 'Google'
    )$$,
  'P0001',
  'company-name-taken',
  'an existing company name cannot be re-created under another domain'
);

-- Google + an actual Google domain still works: the domain decides.
select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000003',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000003',
      p_domain     => 'google.test',
      p_work_email => 'raj@google.test',
      p_code_hash  => 'hash-raj-2',
      p_company_id => (select id from public.companies where name = 'Google')
    )),
    'hash-raj-2'
  )),
  'verified',
  'a member with one of the company''s verified domains joins it'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.name = 'Google' and m.user_id = 'c0c0c0c0-0000-4000-8000-000000000003'),
  1,
  'the joining member is recorded once'
);


-- ─── 5. Domain normalisation and uniqueness ─────────────────

-- The route normalises before it calls in, so a value in any other shape is a
-- bypass rather than a member typing "Figma.com".
select throws_ok(
  $$insert into public.company_domains (company_id, domain)
    values ((select id from public.companies where name = 'Figma'), 'Figma.com')$$,
  '23514',
  'store-domain-case',
  'company_domains rejects an un-normalised domain'
);

select is(
  (select name from public.company_domain_owner('FIGMA.TEST')),
  'Figma',
  'domain lookups are case-insensitive'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain, verified, verified_at)
    values ((select id from public.companies where name = 'Google'), 'figma.test', true, now())$$,
  '23505',
  'verified-domain-unique',
  'a verified domain belongs to exactly one company'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain, verified, verified_at)
    values ((select id from public.companies where name = 'Figma'), 'figma.test', true, now())$$,
  '23505',
  'company-domain-duplicate',
  'a company cannot list the same domain twice'
);

-- An unverified row does not own the domain, so it cannot block anyone: only
-- proven claims own a domain.
insert into public.company_domains (company_id, domain)
values ((select id from public.companies where name = 'Google'), 'figma.test');

select is(
  (select name from public.company_domain_owner('figma.test')),
  'Figma',
  'an unverified row never wins the domain lookup'
);

select is(
  (select count(*)::int from public.search_companies('figma.test')),
  1,
  'an unverified domain does not make a company searchable'
);

-- companies 1 → many company_domains.
insert into public.company_domains (company_id, domain, verified, verified_at)
values ((select id from public.companies where name = 'Google'), 'google.co.in', true, now());

select is(
  (select count(*)::int from public.company_domains as d
    join public.companies as c on c.id = d.company_id
   where c.name = 'Google' and d.verified),
  2,
  'a company can hold multiple verified domains'
);

select is(
  (select jsonb_array_length(domains) from public.get_company_page('google')),
  2,
  'the company page lists every verified domain'
);


-- ─── 6. Membership rules ────────────────────────────────────

select throws_ok(
  $$insert into public.company_members (company_id, user_id, verified)
    values ((select id from public.companies where name = 'Figma'),
            'c0c0c0c0-0000-4000-8000-000000000002', true)$$,
  '23505',
  'duplicate-membership',
  'a member cannot be recorded twice for the same company'
);

select is(
  (select member_count::int from public.search_companies('Google') where name = 'Google'),
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.name = 'Google' and m.verified),
  'search counts the company''s verified members'
);

-- An unverified membership is a record, not a proof: it is never reported as
-- verified, and it does not inflate the member count.
insert into public.company_members (company_id, user_id, verified)
values ((select id from public.companies where name = 'Google'),
        'c0c0c0c0-0000-4000-8000-000000000004', false);

update public.designer_profiles
set company_id = (select id from public.companies where name = 'Google')
where user_id = 'c0c0c0c0-0000-4000-8000-000000000004';

select is(
  (select membership_verified from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000004')),
  false,
  'an unverified membership is reported as unverified'
);

select is(
  (select member_count::int from public.search_companies('Google') where name = 'Google'),
  2,
  'an unverified membership is not counted'
);

-- Promoting that row is what verification does, so a member is never
-- duplicated by joining a company they were already recorded against.
select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000004',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000004',
      p_domain     => 'google.test',
      p_work_email => 'meera@google.test',
      p_code_hash  => 'hash-meera-2',
      p_company_id => (select id from public.companies where name = 'Google')
    )),
    'hash-meera-2'
  )),
  'verified',
  'a member with an unverified row can still verify'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.name = 'Google' and m.verified
     and m.user_id = 'c0c0c0c0-0000-4000-8000-000000000004'),
  1,
  'verifying promotes the unverified row instead of adding a second one'
);


-- ─── 7. Refused claims ──────────────────────────────────────

select throws_ok(
  $$select public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000001',
      p_domain     => 'figma.test',
      p_work_email => 'sachin@figma.test',
      p_code_hash  => 'hash-sachin',
      p_company_id => (select id from public.companies where name = 'Figma')
    )$$,
  'P0001',
  'already-member',
  'an existing member cannot re-verify the same company'
);

select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000006',
      p_domain       => 'midlevel.test',
      p_work_email   => 'dev@elsewhere.test',
      p_code_hash    => 'hash-dev',
      p_company_name => 'Midlevel'
    )$$,
  '22023',
  'email-domain-mismatch',
  'the work email must be on the domain being verified'
);

select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000006',
      p_domain       => 'Midlevel.test',
      p_work_email   => 'dev@midlevel.test',
      p_code_hash    => 'hash-dev',
      p_company_name => 'Midlevel'
    )$$,
  '22023',
  'invalid-domain',
  'an un-normalised domain is rejected outright'
);


-- ─── 8. The OTP challenge ───────────────────────────────────

-- A wrong code is a status, not an exception: the attempt counter has to
-- survive, which an exception would roll back.
select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000006',
    (select verification_id from public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000006',
      p_domain       => 'midlevel.test',
      p_work_email   => 'dev@midlevel.test',
      p_code_hash    => 'hash-dev',
      p_company_name => 'Midlevel'
    )),
    'wrong-code'
  )),
  'invalid_code',
  'a wrong code is rejected'
);

select is(
  (select attempts_left from public.get_pending_company_verification('c0c0c0c0-0000-4000-8000-000000000006')),
  4,
  'the wrong guess is recorded against the challenge'
);

select is(
  (select count(*)::int from public.company_domains as d
    join public.companies as c on c.id = d.company_id
   where c.name = 'Midlevel'),
  0,
  'a failed challenge verifies nothing'
);

-- A challenge belongs to the member who started it.
select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000003',
    (select verification_id from public.get_pending_company_verification('c0c0c0c0-0000-4000-8000-000000000006')),
    'hash-dev'
  )),
  'not_found',
  'another member cannot confirm someone else''s challenge'
);

-- Starting again retires the previous code so a resend cannot be replayed.
select ok(
  (select verification_id from public.start_company_verification(
     p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000006',
     p_domain       => 'midlevel.test',
     p_work_email   => 'dev@midlevel.test',
     p_code_hash    => 'hash-dev',
     p_company_name => 'Midlevel'
   )) is not null,
  'a resend opens a fresh challenge'
);

select is(
  (select count(*)::int from public.company_email_verifications
   where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is null),
  1,
  'exactly one challenge is live per member'
);

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000006',
    (select id from public.company_email_verifications
     where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is not null
     order by created_at asc limit 1),
    'hash-dev'
  )),
  'already_used',
  'the retired code can no longer be confirmed'
);

-- Four guesses are already spent; the fifth burns the challenge.
update public.company_email_verifications
set attempts = 4
where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is null;

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000006',
    (select verification_id from public.get_pending_company_verification('c0c0c0c0-0000-4000-8000-000000000006')),
    'wrong-code'
  )),
  'invalid_code',
  'the fifth wrong code is rejected'
);

select is(
  (select count(*)::int from public.company_email_verifications
   where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is null),
  0,
  'the fifth wrong code burns the outstanding challenge'
);

-- A row that somehow reached the attempt ceiling without being burned is
-- refused rather than compared.
insert into public.company_email_verifications (
  user_id, company_name, domain, work_email, code_hash, attempts, expires_at
) values (
  'c0c0c0c0-0000-4000-8000-000000000006', 'Midlevel', 'midlevel.test',
  'dev@midlevel.test', 'hash-dev', 5, now() + interval '10 minutes'
);

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000006',
    (select id from public.company_email_verifications
     where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is null
     order by created_at desc limit 1),
    'hash-dev'
  )),
  'too_many_attempts',
  'a challenge at the attempt ceiling is refused'
);

delete from public.company_email_verifications
where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is null;

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000006',
    (select verification_id from public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000006',
      p_domain       => 'midlevel.test',
      p_work_email   => 'dev@midlevel.test',
      p_code_hash    => 'hash-dev-2',
      p_company_name => 'Midlevel'
    )),
    'hash-dev-2'
  )),
  'verified',
  'a fresh challenge after a burned one succeeds'
);

select is(
  (select count(*)::int from public.company_domains as d
    join public.companies as c on c.id = d.company_id
   where c.name = 'Midlevel' and d.domain = 'midlevel.test' and d.verified),
  1,
  'the successful challenge verifies the domain'
);

-- Expiry is evaluated at confirmation time, not only when the code was sent.
insert into public.company_email_verifications (
  user_id, company_id, company_name, domain, work_email, code_hash, expires_at
) values (
  'c0c0c0c0-0000-4000-8000-000000000006',
  (select id from public.companies where name = 'Midlevel'),
  'Midlevel', 'midlevel.test', 'dev@midlevel.test', 'hash-dev-3',
  now() - interval '1 minute'
);

select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000006',
    (select id from public.company_email_verifications
     where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is null
     order by created_at desc limit 1),
    'hash-dev-3'
  )),
  'expired',
  'an expired challenge is refused'
);

-- A resend needs the work email a challenge was issued for even once that
-- challenge is spent, because after a reload the browser no longer holds the
-- address. The row is readable by its owner and nobody else.
select is(
  (select work_email from public.get_pending_company_verification(
     'c0c0c0c0-0000-4000-8000-000000000006',
     (select id from public.company_email_verifications
      where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is not null
      order by created_at desc limit 1)
   )),
  'dev@midlevel.test',
  'a spent challenge can still be read by the member who started it'
);

select is(
  (select count(*)::int from public.get_pending_company_verification(
     'c0c0c0c0-0000-4000-8000-000000000003',
     (select id from public.company_email_verifications
      where user_id = 'c0c0c0c0-0000-4000-8000-000000000006' and consumed_at is not null
      order by created_at desc limit 1)
   )),
  0,
  'another member cannot read a challenge by id'
);

select is(
  (select count(*)::int from public.get_pending_company_verification(
     'c0c0c0c0-0000-4000-8000-000000000006', null
   )),
  0,
  'without an id only a live challenge is returned'
);


-- ─── 9. Search ──────────────────────────────────────────────

-- Asserted by name, not by count: the directory is generated and grows, so a
-- bare count here would break the moment another company's name starts with the
-- same three letters.
select is(
  (select count(*)::int from public.search_companies('fig') where name = 'Figma'),
  1,
  'search finds a company by name prefix'
);

select is(
  (select name from public.search_companies('figma.test')),
  'Figma',
  'search finds a company by its verified domain'
);

select is(
  (select verified from public.search_companies('figma.test')),
  true,
  'search reports the domain as verified'
);

select is(
  (select count(*)::int from public.search_companies('%')),
  0,
  'LIKE wildcards in the query are escaped, so "%" searches literally'
);

select is(
  (select count(*)::int from public.search_companies('nonexistent-company-name')),
  0,
  'search returns nothing for an unknown company'
);

insert into public.companies (name, slug, is_active)
values ('Stale Co', 'stale-co', false);

-- Listed with the domain it is known by, like any directory entry: a company
-- nobody can prove is a dead end, which section 11 asserts none of them are.
insert into public.company_domains (company_id, domain)
select id, 'stale.co' from public.companies where slug = 'stale-co';

select is(
  (select count(*)::int from public.search_companies('Stale Co')),
  0,
  'a deactivated company is hidden from search'
);

select is(
  (select count(*)::int from public.companies where name = 'Stale Co'),
  1,
  'a deactivated company is hidden, not deleted'
);

select throws_ok(
  $$select public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000001',
      p_domain     => 'stale.co',
      p_work_email => 'sachin@stale.co',
      p_code_hash  => 'hash-sachin',
      p_company_id => (select id from public.companies where name = 'Stale Co')
    )$$,
  'P0001',
  'company-inactive',
  'a deactivated company cannot take new members'
);


-- ─── 10. Profile display ────────────────────────────────────

select is(
  (select name from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000002')),
  'Figma',
  'a joining member displays the company on their profile'
);

select is(
  (select count(*)::int from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000003')),
  1,
  'the profile read model returns one company'
);

select is(
  (select (members::text not like '%@%') from public.get_company_page('google')),
  true,
  'the company page never exposes member work emails'
);

select is(
  (select member_count from public.get_company_page('google')),
  3::bigint,
  'the company page counts verified members'
);

select is(
  (select count(*)::int from public.get_company_page('not-a-company')),
  0,
  'the company page returns nothing for an unknown slug'
);

select is(
  (select domain_verified from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000002')),
  true,
  'the profile read model reports the domain as verified'
);


-- ─── 11. Leaving, and deleting a company ────────────────────

select is(
  public.leave_company('c0c0c0c0-0000-4000-8000-000000000002'),
  true,
  'a member can leave the company on their profile'
);

select is(
  (select dp.company_id from public.designer_profiles as dp
   where dp.user_id = 'c0c0c0c0-0000-4000-8000-000000000002'),
  null,
  'leaving clears the profile pointer'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.name = 'Figma' and m.user_id = 'c0c0c0c0-0000-4000-8000-000000000002'),
  0,
  'leaving removes the membership row'
);

select is(
  public.leave_company('c0c0c0c0-0000-4000-8000-000000000002'),
  false,
  'leaving twice is a no-op'
);

select is(
  (select count(*)::int from public.companies where name = 'Figma'),
  1,
  'leaving does not delete the company'
);

-- Deleting a company must never delete a member's profile.
delete from public.companies where name = 'Figma';

select is(
  (select dp.company_id from public.designer_profiles as dp
   where dp.user_id = 'c0c0c0c0-0000-4000-8000-000000000001'),
  null,
  'deleting a company clears the profile pointer instead of the profile'
);

select is(
  (select count(*)::int from public.designer_profiles as dp
   where dp.user_id = 'c0c0c0c0-0000-4000-8000-000000000001'),
  1,
  'the member profile survives the company being deleted'
);

select is(
  (select count(*)::int from public.company_domains
   where domain = 'figma.test' and verified),
  0,
  'deleting a company removes its verified domains'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.name = 'Google' and m.verified),
  3,
  'other companies are untouched'
);

-- ─── 11. The default directory: a hint is a name to prove ───

-- 20260929140000_company_directory.sql seeds companies with the domain each is
-- known by, as UNVERIFIED rows: hints. These assertions pin what a hint may
-- do — be found, be joined, and be promoted by the first member who proves the
-- mailbox — and what it may not: own a domain, answer a domain search, or
-- stand in for the emailed code.

-- Two directory entries exactly as that seed writes them: a company, plus an
-- unproved domain. Nothing here verifies anything.
insert into public.companies (name, slug) values ('Hintco', 'hintco'), ('Reserved Co', 'reserved-co');
insert into public.company_domains (company_id, domain)
select id, 'hintco.test' from public.companies where slug = 'hintco';
insert into public.company_domains (company_id, domain)
select id, 'reserved.test' from public.companies where slug = 'reserved-co';

select is(
  (select domain from public.search_companies('Hintco')),
  'hintco.test',
  'search reports the domain a directory entry is known by'
);

select is(
  (select verified from public.search_companies('Hintco')),
  false,
  'search never reports a directory domain as verified'
);

select is(
  (select verified from public.company_domain_owner('hintco.test')),
  false,
  'the domain owner lookup returns a hint unverified, so routing never follows it'
);

select is(
  (select count(*)::int from public.search_companies('hintco.test')),
  0,
  'a hint does not answer a domain search'
);

-- A member picks Hintco from the directory and gives a work email on the domain
-- the directory knows it by. This has to open a challenge: without hints this
-- path was closed (no verified domain to match) while the name was taken, which
-- is the dead end the seed would otherwise create for every company it lists.
select is(
  (select company_name from public.start_company_verification(
    p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000007',
    p_domain     => 'hintco.test',
    p_work_email => 'asha@hintco.test',
    p_code_hash  => 'hash-asha',
    p_company_id => (select id from public.companies where slug = 'hintco')
  )),
  'Hintco',
  'a directory hint is enough to open a work-email challenge'
);

-- Proving the mailbox is still what turns the hint into a claim: the challenge
-- above only exists because a code has to come back.
select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000007',
    (select id from public.company_email_verifications
      where user_id = 'c0c0c0c0-0000-4000-8000-000000000007' and consumed_at is null),
    'hash-asha'
  )),
  'verified',
  'confirming the code promotes the directory hint'
);

select is(
  (select count(*)::int from public.company_domains where domain = 'hintco.test'),
  1,
  'the hint row is promoted, not duplicated'
);

select is(
  (select verified from public.company_domains where domain = 'hintco.test'),
  true,
  'the promoted domain row is verified by the member''s proof'
);

select is(
  (select count(*)::int from public.companies where lower(name) = 'hintco'),
  1,
  'proving a hinted domain creates no second company'
);

select is(
  (select name from public.get_user_company('c0c0c0c0-0000-4000-8000-000000000007')),
  'Hintco',
  'the member who proved the hinted domain displays its company'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.slug = 'hintco' and m.verified),
  1,
  'the member joins the directory company once'
);

-- A hint is not a blanket invitation: Hintco is verified for hintco.test alone,
-- so an unrelated domain still cannot join it.
select throws_ok(
  $$select public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000008',
      p_domain     => 'elsewhere.test',
      p_work_email => 'vikram@elsewhere.test',
      p_code_hash  => 'hash-vikram',
      p_company_id => (select id from public.companies where slug = 'hintco')
    )$$,
  'P0001',
  'hint-does-not-open-other-domains',
  'a directory company still refuses a domain it never listed'
);

-- Naming a company on a domain the directory already maps elsewhere is refused
-- (proving it here would invent a second company for one domain).
select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'c0c0c0c0-0000-4000-8000-000000000008',
      p_domain       => 'reserved.test',
      p_work_email   => 'vikram@reserved.test',
      p_code_hash    => 'hash-vikram',
      p_company_name => 'Reserved Co Two'
    )$$,
  'P0001',
  'hint-domain-reserved',
  'a domain the directory already lists cannot be spent on a new company'
);

select is(
  (select count(*)::int from public.companies where lower(name) = 'reserved co two'),
  0,
  'the reserved-domain refusal created no company'
);

-- The refusal above is the same message whether the holder's claim is proved or
-- only listed, so the route tells the member which it is through the exception
-- detail. The helper is local to this file: pgTAP assertions are queries, and
-- an exception detail is only reachable from inside a handler.
create or replace function public.test_company_refusal_reason(
  p_user_id      uuid,
  p_domain       text,
  p_work_email   text,
  p_company_name text
) returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  begin
    perform public.start_company_verification(
      p_user_id      => p_user_id,
      p_domain       => p_domain,
      p_work_email   => p_work_email,
      p_code_hash    => 'hash-reason',
      p_company_name => p_company_name
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb ->> 'reason';
  end;
  return null;
end;
$$;

select is(
  public.test_company_refusal_reason(
    'c0c0c0c0-0000-4000-8000-000000000008',
    'reserved.test',
    'vikram@reserved.test',
    'Reserved Co Two'
  ),
  'reserved',
  'a domain the directory lists is reported as reserved, not as proved'
);

select is(
  public.test_company_refusal_reason(
    'c0c0c0c0-0000-4000-8000-000000000008',
    'hintco.test',
    'vikram@hintco.test',
    'Hintco Clone'
  ),
  'verified',
  'a domain somebody has proved is reported as verified'
);

-- ...and joining the company that holds it works, with the same work email.
select is(
  (select status from public.confirm_company_verification(
    'c0c0c0c0-0000-4000-8000-000000000008',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'c0c0c0c0-0000-4000-8000-000000000008',
      p_domain     => 'reserved.test',
      p_work_email => 'vikram@reserved.test',
      p_code_hash  => 'hash-vikram-2',
      p_company_id => (select id from public.companies where slug = 'reserved-co')
    )),
    'hash-vikram-2'
  )),
  'verified',
  'the member joins the company the domain is listed for'
);

select is(
  (select count(*)::int from public.company_domains where domain = 'reserved.test' and verified),
  1,
  'joining promotes that company''s own hint to a verified claim'
);

-- The directory itself has to be there: the picker is only useful if the seed
-- applied, and what it plants has to be a hint rather than a claim.
select is(
  (select count(*)::int from public.companies where slug = 'flipkart'),
  1,
  'the default company directory is loaded'
);

select is(
  (select d.verified from public.company_domains as d
    join public.companies as c on c.id = d.company_id
   where c.slug = 'flipkart' and d.domain = 'flipkart.com'),
  false,
  'a seeded domain starts as an unproved hint'
);

-- The invariants the generator has to keep. Each one, if it broke, would put a
-- dead end in the picker: a listed company nobody can join, a domain two
-- companies both claim, or a consumer mailbox offered as an employer.
select ok(
  (select count(*) from public.companies where created_by is null) >= 1000,
  'the directory is a real list, not a stub'
);

select is(
  (select count(*)::int from public.companies as c
    where c.created_by is null
      and not exists (select 1 from public.company_domains as d where d.company_id = c.id)),
  0,
  'every directory entry has a domain a member can prove'
);

select is(
  (select count(*)::int from (
     select d.domain
     from public.company_domains as d
     join public.companies as c on c.id = d.company_id
     where c.created_by is null
     group by d.domain
     having count(*) > 1
   ) as duplicates),
  0,
  'no domain is offered by two directory entries'
);

select is(
  (select count(*)::int from public.company_domains as d
    join public.companies as c on c.id = d.company_id
   where c.created_by is null
     and d.domain in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
                      'icloud.com', 'proton.me', 'mail.ru', 'qq.com')),
  0,
  'no consumer mailbox domain is offered as a company domain'
);

select * from finish();
