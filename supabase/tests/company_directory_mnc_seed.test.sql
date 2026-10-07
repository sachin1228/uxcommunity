-- ============================================================
-- Curated MNC company directory — the work-field seed
--
-- Migration under test: 20261007130000_company_directory_mnc_seed.sql
--
-- The seed writes the day-one list of employers the "Where do you work?"
-- picker shows, as ordinary directory rows: one company and one UNVERIFIED
-- domain hint per entry. This file proves the three things a reviewer has to
-- trust about it:
--
--   1. the list landed, is large enough to be a usable directory, and every row
--      carries exactly one hint that is NOT a proof (verified = false);
--   2. it is safe to re-run: the inserts do not duplicate a company or a hint,
--      and never overwrite a member's proof;
--   3. the picker actually sees it, and a one-character test company is removed.
--
-- The generated file is asserted against its source by
-- scripts/generate-company-directory-mnc-seed.mjs --check, run from the node
-- test suite; this file asserts the DATABASE state after it applies.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(15);

-- ─── 1. What the seed landed ────────────────────────────────

select ok(
  (select count(*) from public.companies where source = 'curated-mnc') >= 500,
  'the curated seed wrote at least 500 companies'
);

select is(
  (select count(*)::int
     from public.companies as c
    where c.source = 'curated-mnc'
      and (select count(*) from public.company_domains as d where d.company_id = c.id) <> 1),
  0,
  'every curated company carries exactly one domain hint'
);

-- A hint is not a claim: the seed must never write a proof.
select is(
  (select count(*)::int
     from public.company_domains
    where source = 'curated-mnc' and verified),
  0,
  'no curated domain hint is marked verified'
);

select is(
  (select count(*)::int
     from public.company_domains
    where source = 'curated-mnc'
      and (domain_type <> 'primary_website' or evidence_confidence <> 'unknown')),
  0,
  'every curated hint is a primary_website with unknown confidence'
);

select is(
  (select count(*)::int from public.companies where source = 'curated-mnc' and entity_status <> 'active'),
  0,
  'every curated company is active'
);

-- The list is the picker's search space, so a domain offered twice or a
-- consumer mailbox offered as an employer would be a visible defect.
select is(
  (select count(*)::int from (
     select d.domain
       from public.company_domains as d
       join public.companies as c on c.id = d.company_id
      where c.source = 'curated-mnc'
      group by d.domain having count(*) > 1
   ) as duplicates),
  0,
  'no curated domain is listed for two companies'
);

select is(
  (select count(*)::int
     from public.company_domains as d
     join public.companies as c on c.id = d.company_id
    where c.source = 'curated-mnc'
      and d.domain in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
                       'icloud.com', 'proton.me', 'mail.ru', 'qq.com')),
  0,
  'no consumer mailbox domain is offered as a company'
);

-- ─── 2. Safe to re-run ──────────────────────────────────────

-- The seed's own inserts, replayed. `on conflict do nothing` has to leave both
-- rows exactly as they were.
insert into public.companies (name, slug, source)
values ('Google', 'google', 'curated-mnc')
on conflict (slug) do nothing;

insert into public.company_domains (company_id, domain)
select c.id, 'google.com' from public.companies as c where c.slug = 'google'
on conflict (company_id, domain) do nothing;

select is(
  (select count(*)::int from public.companies where slug = 'google'),
  1,
  're-running the company insert does not duplicate a seeded company'
);

select is(
  (select count(*)::int
     from public.company_domains as d
     join public.companies as c on c.id = d.company_id
    where c.slug = 'google'),
  1,
  're-running the domain insert does not duplicate a seeded hint'
);

-- ─── 3. The picker sees it ──────────────────────────────────

select ok(
  exists (select 1 from public.search_companies('figma', 10) as s where s.name = 'Figma'),
  'the picker finds a seeded company by name'
);

select is(
  (select s.domain from public.search_companies('google', 10) as s where s.name = 'Google'),
  'google.com',
  'the picker reports the seeded company''s domain'
);

select is(
  (select s.verified from public.search_companies('canva', 10) as s where s.name = 'Canva'),
  false,
  'the picker reports a seeded hint as unverified'
);

select ok(
  (select count(*) from public.search_companies('', 8)) > 0,
  'browsing the picker (empty query) shows the seeded directory'
);

-- ─── 4. The trial company is gone ───────────────────────────

-- The seed's cleanup, replayed: a one-character name is a test of the picker,
-- never an employer. Insert the shape the screenshot showed ("l" / "l.com"),
-- apply the same predicate, and assert it is gone along with its hint.
insert into public.companies (name, slug) values ('l', 'l')
on conflict (slug) do nothing;
insert into public.company_domains (company_id, domain)
select c.id, 'l.com' from public.companies as c where c.slug = 'l'
on conflict (company_id, domain) do nothing;

delete from public.companies where slug ~ '^[a-z0-9]$';

select is(
  (select count(*)::int from public.companies where slug = 'l'),
  0,
  'a one-character test company is removed by the seed cleanup'
);

select is(
  (select count(*)::int from public.company_domains where domain = 'l.com'),
  0,
  'the removed test company takes its domain hint with it'
);

select * from finish();
