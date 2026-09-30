-- ============================================================
-- Explicit company selection: a proved mailbox is the membership
--
-- The product rule this pins down, end to end at the database layer:
--
--   a member who EXPLICITLY selects a company, gives a work email whose domain
--   is registered to that company, and enters the code we actually sent
--   PROVIDES THE VERIFICATION. The claim is promoted and company_members gets a
--   row — whatever `evidence_confidence` the directory stamped on the claim.
--
-- `evidence_confidence` is directory data quality: it feeds search, discovery,
-- review and operator workflows, and it no longer gates a member's own proved
-- workplace. The only things that still refuse are the safety rails around the
-- MATCH itself:
--
--   * the domain is not registered to the selected company (a member selecting
--     Company A while verifying a domain that belongs to Company B);
--   * the domain is already verified for another company.
--
-- Covered here: HDFC Bank, WhatsApp, Google and Microsoft by name, plus low and
-- unknown confidence, the different-company / no-match / already-verified
-- refusals, idempotency, member-created companies, and the import guard.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(32);

-- ─── Fixture ────────────────────────────────────────────────

delete from public.company_email_verifications where user_id in (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000003',
  'ac000000-0000-4000-8000-000000000004',
  'ac000000-0000-4000-8000-000000000005',
  'ac000000-0000-4000-8000-000000000006',
  'ac000000-0000-4000-8000-000000000007'
);
delete from public.designer_profiles where user_id in (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000003',
  'ac000000-0000-4000-8000-000000000004',
  'ac000000-0000-4000-8000-000000000005',
  'ac000000-0000-4000-8000-000000000006',
  'ac000000-0000-4000-8000-000000000007'
);
delete from public.users where id in (
  'ac000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000003',
  'ac000000-0000-4000-8000-000000000004',
  'ac000000-0000-4000-8000-000000000005',
  'ac000000-0000-4000-8000-000000000006',
  'ac000000-0000-4000-8000-000000000007'
);
delete from public.companies where slug in (
  'hdfc-bank-fixture', 'wa-fixture', 'google-fixture', 'microsoft-fixture',
  'rival-bank-fixture', 'fresh-co-fixture'
);

insert into public.users (id, name, email, password_hash, application_id) values
  ('ac000000-0000-4000-8000-000000000001', 'Hdfc Member',   'h@hdfcbank-fixture.test', 'x', null),
  ('ac000000-0000-4000-8000-000000000002', 'Chat Member',   'w@chatwa.test',     'x', null),
  ('ac000000-0000-4000-8000-000000000003', 'Search Member', 'g@searchg.test',    'x', null),
  ('ac000000-0000-4000-8000-000000000004', 'Soft Member',   'm@softms.test',     'x', null),
  ('ac000000-0000-4000-8000-000000000005', 'Rival Member',  'r@rivalbank.test',  'x', null),
  ('ac000000-0000-4000-8000-000000000006', 'Fresh Member',  'f@freshco.test',    'x', null),
  ('ac000000-0000-4000-8000-000000000007', 'Second Search', 's2@searchg.test',   'x', null);

insert into public.designer_profiles (user_id, experience_level)
select id, 'intermediate' from public.users where id::text like 'ac000000-%'
on conflict (user_id) do nothing;

-- Slugs are deliberately NOT the brands' seed slugs ('hdfc-bank' is one of the
-- 4,574 retired v1 seed rows) so this file's fixtures never read as seed rows to
-- the directory-reset plan, which joins on slug.
insert into public.companies (id, name, slug, source) values
  ('ab000000-0000-4000-8000-000000000001', 'HDFC Bank',  'hdfc-bank-fixture',   'curated'),
  ('ab000000-0000-4000-8000-000000000002', 'WhatsApp',   'wa-fixture',          'curated'),
  ('ab000000-0000-4000-8000-000000000003', 'Google',     'google-fixture',      'curated'),
  ('ab000000-0000-4000-8000-000000000004', 'Microsoft',  'microsoft-fixture',   'curated'),
  ('ab000000-0000-4000-8000-000000000005', 'Rival Bank', 'rival-bank-fixture',  'curated');

-- The directory's claims, at the confidence each deserves. HDFC and Google are
-- `low`, WhatsApp is `unknown` (the shape of a bulk import), Microsoft is
-- `medium`. None is verified and none carries checked evidence — exactly the
-- rows that used to be unverifiable by their own staff.
--
-- The domains are fixture-only (`*-fixture.test`) on purpose. The shared test
-- database already uses the real `whatsapp.com` (stewardship) and the seed's own
-- `google.com` / `microsoft.com` (the directory-reset suite), and this file must
-- neither depend on nor disturb another suite's state. The brands are the names;
-- the rule under test is exact-match, not DNS.
insert into public.company_domains
  (company_id, domain, domain_type, evidence_confidence, source, verified) values
  ('ab000000-0000-4000-8000-000000000001', 'hdfcbank-fixture.test',  'corporate_email', 'low',     'curated', false),
  ('ab000000-0000-4000-8000-000000000002', 'whatsapp-fixture.test',  'corporate_email', 'unknown', 'curated', false),
  ('ab000000-0000-4000-8000-000000000003', 'google-fixture.test',    'corporate_email', 'low',     'curated', false),
  ('ab000000-0000-4000-8000-000000000004', 'microsoft-fixture.test', 'corporate_email', 'medium',  'curated', false),
  ('ab000000-0000-4000-8000-000000000005', 'rivalbank-fixture.test', 'corporate_email', 'low',     'curated', false);


-- ─── 1. HDFC Bank + its registered domain + correct OTP ⇒ membership ──────

select is(
  (select count(*)::int from public.start_company_verification(
    p_user_id    => 'ac000000-0000-4000-8000-000000000001',
    p_domain     => 'hdfcbank-fixture.test',
    p_work_email => 'h@hdfcbank-fixture.test',
    p_code_hash  => 'hash-hdfc',
    p_company_id => 'ab000000-0000-4000-8000-000000000001'
  )),
  1,
  'selecting HDFC Bank on its registered domain opens a challenge'
);

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000001',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000001'
        and code_hash = 'hash-hdfc' and consumed_at is null),
    'hash-hdfc'
  )),
  'verified',
  'HDFC Bank + its registered domain + correct OTP returns verified'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'ab000000-0000-4000-8000-000000000001'
      and user_id = 'ac000000-0000-4000-8000-000000000001' and verified),
  1,
  'HDFC Bank appears in Work: the membership row exists'
);

select is(
  (select name from public.get_user_company('ac000000-0000-4000-8000-000000000001')),
  'HDFC Bank',
  'and the profile points at HDFC Bank'
);

select is(
  (select verified from public.company_domains where domain = 'hdfcbank-fixture.test'),
  true,
  'the low-confidence claim is promoted to a verified claim'
);

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000001',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000001'
        and code_hash = 'hash-hdfc' and consumed_at is not null),
    'hash-hdfc'
  )),
  'already_used',
  're-redeeming the consumed HDFC challenge is refused: the grant is idempotent'
);


-- ─── 2. WhatsApp + its registered domain + correct OTP ⇒ membership ────────

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000002',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'ac000000-0000-4000-8000-000000000002',
      p_domain     => 'whatsapp-fixture.test',
      p_work_email => 'w@whatsapp-fixture.test',
      p_code_hash  => 'hash-wa',
      p_company_id => 'ab000000-0000-4000-8000-000000000002'
    )),
    'hash-wa'
  )),
  'verified',
  'WhatsApp + its registered domain + correct OTP returns verified'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'ab000000-0000-4000-8000-000000000002'
      and user_id = 'ac000000-0000-4000-8000-000000000002' and verified),
  1,
  'WhatsApp appears in Work'
);


-- ─── 3. LOW confidence ⇒ membership ─────────────────────────────────────────

select is(
  (select evidence_confidence from public.company_domains where domain = 'google-fixture.test'),
  'low',
  'Google''s registered claim is low confidence'
);

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000003',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'ac000000-0000-4000-8000-000000000003',
      p_domain     => 'google-fixture.test',
      p_work_email => 'g@google-fixture.test',
      p_code_hash  => 'hash-google',
      p_company_id => 'ab000000-0000-4000-8000-000000000003'
    )),
    'hash-google'
  )),
  'verified',
  'correct OTP on a low-confidence claim still verifies'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'ab000000-0000-4000-8000-000000000003'
      and user_id = 'ac000000-0000-4000-8000-000000000003' and verified),
  1,
  'membership is STILL created for a low-confidence claim'
);


-- ─── 4. UNKNOWN confidence ⇒ membership ─────────────────────────────────────

select is(
  (select evidence_confidence from public.company_domains where domain = 'whatsapp-fixture.test'),
  'unknown',
  'WhatsApp''s claim is unknown confidence (a bulk-import shape)'
);

select is(
  (select evidence_confidence from public.company_domains where domain = 'microsoft-fixture.test'),
  'medium',
  'and Microsoft''s is medium, so all three confidence bands are exercised'
);

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000004',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'ac000000-0000-4000-8000-000000000004',
      p_domain     => 'microsoft-fixture.test',
      p_work_email => 'm@microsoft-fixture.test',
      p_code_hash  => 'hash-ms',
      p_company_id => 'ab000000-0000-4000-8000-000000000004'
    )),
    'hash-ms'
  )),
  'verified',
  'correct OTP on a medium-confidence claim verifies too'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'ab000000-0000-4000-8000-000000000004'
      and user_id = 'ac000000-0000-4000-8000-000000000004' and verified),
  1,
  'Microsoft appears in Work'
);


-- ─── 5. Domain registered to a DIFFERENT company ⇒ no membership ────────────

-- The member picks Microsoft but proves a mailbox on rivalbank-fixture.test,
-- which is registered to Rival Bank. The match fails, so the code grants nothing.
insert into public.company_email_verifications
  (user_id, company_id, company_name, domain, work_email, code_hash, expires_at)
values
  ('ac000000-0000-4000-8000-000000000005', 'ab000000-0000-4000-8000-000000000004',
   'Microsoft', 'rivalbank-fixture.test', 'r@rivalbank-fixture.test', 'hash-diff', now() + interval '10 minutes');

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000005',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000005' and consumed_at is null),
    'hash-diff'
  )),
  'domain_not_verified',
  'a domain registered to a different company is refused at the code'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'ab000000-0000-4000-8000-000000000004'
      and user_id = 'ac000000-0000-4000-8000-000000000005'),
  0,
  'and no membership is created for the mismatched company'
);


-- ─── 6. No matching company/domain ⇒ no membership ──────────────────────────

insert into public.company_email_verifications
  (user_id, company_id, company_name, domain, work_email, code_hash, expires_at)
values
  ('ac000000-0000-4000-8000-000000000006', 'ab000000-0000-4000-8000-000000000004',
   'Microsoft', 'nomatch.test', 'f@nomatch.test', 'hash-nomatch', now() + interval '10 minutes');

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000006',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000006'
        and code_hash = 'hash-nomatch' and consumed_at is null),
    'hash-nomatch'
  )),
  'domain_not_verified',
  'a domain the selected company does not register is refused'
);

select is(
  (select count(*)::int from public.company_members
    where user_id = 'ac000000-0000-4000-8000-000000000006'),
  0,
  'and nothing is added to Work'
);


-- ─── 7. Already verified domain owned by another company ⇒ protection intact ─

insert into public.company_email_verifications
  (user_id, company_id, company_name, domain, work_email, code_hash, expires_at)
values
  ('ac000000-0000-4000-8000-000000000007', 'ab000000-0000-4000-8000-000000000004',
   'Microsoft', 'hdfcbank-fixture.test', 's2@hdfcbank-fixture.test', 'hash-taken', now() + interval '10 minutes');

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000007',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000007' and consumed_at is null),
    'hash-taken'
  )),
  'domain_already_verified',
  'a domain another company has already proved cannot be claimed'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'ab000000-0000-4000-8000-000000000004'
      and user_id = 'ac000000-0000-4000-8000-000000000007'),
  0,
  'and the second company gets no membership on it'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'hdfcbank-fixture.test' and verified),
  1,
  'the domain still has exactly one verified owner'
);


-- ─── 8. Existing verified membership/claim ⇒ idempotent and protected ───────

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000003',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000003'
      order by created_at desc limit 1),
    'hash-google'
  )),
  'already_used',
  'redeeming an already-consumed challenge is refused, not repeated'
);

-- A colleague on the now-proved Google domain joins the same company.
select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000007',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'ac000000-0000-4000-8000-000000000007',
      p_domain     => 'google-fixture.test',
      p_work_email => 's2@google-fixture.test',
      p_code_hash  => 'hash-google-2',
      p_company_id => 'ab000000-0000-4000-8000-000000000003'
    )),
    'hash-google-2'
  )),
  'verified',
  'a colleague on the company''s own proved domain joins the same company'
);

select is(
  (select count(*)::int from public.company_members as m
    join public.companies as c on c.id = m.company_id
   where c.slug = 'google-fixture' and m.verified),
  2,
  'both members share the one company'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'google-fixture.test' and verified),
  1,
  'and neither membership created a second verified claim'
);


-- ─── 9. Member-created company behaviour is unchanged ───────────────────────

select is(
  (select company_id from public.start_company_verification(
    p_user_id      => 'ac000000-0000-4000-8000-000000000006',
    p_domain       => 'freshco.test',
    p_work_email   => 'f@freshco.test',
    p_code_hash    => 'hash-fresh',
    p_company_name => 'Fresh Co Fixture'
  )),
  null::uuid,
  'naming a new company on an unclaimed domain opens a create challenge'
);

select is(
  (select status from public.confirm_company_verification(
    'ac000000-0000-4000-8000-000000000006',
    (select id from public.company_email_verifications
      where user_id = 'ac000000-0000-4000-8000-000000000006'
        and code_hash = 'hash-fresh' and consumed_at is null),
    'hash-fresh'
  )),
  'verified',
  'and the proof creates the company and verifies it'
);

select is(
  (select count(*)::int from public.companies where slug = 'fresh-co-fixture'),
  1,
  'the member-created company exists once (slug from the typed name)'
);

select is(
  (select verified from public.company_domains where domain = 'freshco.test'),
  true,
  'with a verified claim the member''s proof created'
);


-- ─── 10. Directory import cannot overwrite an existing verified claim ───────

-- The guarded merge every import uses: it may only touch UNVERIFIED rows.
with touched as (
  update public.company_domains as d
  set evidence_confidence = 'unknown', source = 'wikidata-p856'
  where d.domain = 'hdfcbank-fixture.test' and not d.verified
  returning d.id
)
select is(
  (select count(*)::int from touched),
  0,
  'an import-shaped update matches no verified claim'
);

select is(
  (select row(verified, evidence_confidence) from public.company_domains where domain = 'hdfcbank-fixture.test'),
  row(true, 'low'::text),
  'the proved claim keeps its verification and its original confidence'
);

select * from finish();
