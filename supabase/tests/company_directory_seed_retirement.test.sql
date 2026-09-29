-- ============================================================
-- Retiring the seeded company directory
--
-- Migration under test: 20260929153000_company_directory_seed_retirement.sql.
--
-- By the time this file runs, the migration has already retired the real seed,
-- so the test rebuilds a small version of the situation it was written for:
-- seeded companies with the seed's own slugs and domains, one of each way a
-- person or an operator can touch a row, and one company that is not part of the
-- seed at all.
--
-- What these assertions are really guarding:
--
--   * the identification is exact — a row is removable only when its slug is in
--     the seed's own list AND nobody has touched it;
--   * application data is not directory data: a membership, a verification
--     record, a profile pointer, an operator decision, a delegation or an
--     observation keeps the company, and the retained view says why;
--   * a member's company is never a seed row, even when the name matches;
--   * nothing outside the seed list is touched, and no claim is left orphaned;
--   * re-running deletes nothing, and the dry run deletes nothing while still
--     reporting what it would do;
--   * the transition is service-role only.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(42);

-- ─── Fixture ────────────────────────────────────────────────

delete from public.companies
 where slug in ('google', 'microsoft', 'apple', 'netflix', 'spotify', 'stripe',
                'shopify', 'adobe', 'amazon', 'trustpilot', 'oracle',
                'retirement-bystander', 'a-member-company');
delete from public.users where email like '%@seed-retirement.test';

insert into public.users (id, name, email, password_hash) values
  ('f0f0f0f0-0000-4000-8000-000000000001', 'Retired Joiner',   'joiner@seed-retirement.test',   'x'),
  ('f0f0f0f0-0000-4000-8000-000000000002', 'Retired Reviewer', 'reviewer@seed-retirement.test', 'x'),
  ('f0f0f0f0-0000-4000-8000-000000000003', 'Retired Member',   'member@seed-retirement.test',   'x');

insert into public.designer_profiles (user_id, experience_level)
select u.id, 'intermediate' from public.users as u
where u.email like '%@seed-retirement.test'
on conflict (user_id) do nothing;

-- The seed's own identity, straight out of the durable record the migration
-- wrote: the slug the database's `company_slugify` produced for the seed's name.
insert into public.companies (name, slug, source, source_confidence)
select r.name, r.slug, 'wikidata-p856', 'unknown'
from public.company_directory_seed_retired as r
where r.slug in ('google', 'microsoft', 'apple', 'netflix', 'spotify', 'stripe',
                 'shopify', 'adobe', 'amazon', 'trustpilot', 'oracle');

insert into public.company_domains (company_id, domain, domain_type, evidence_confidence, source)
select c.id, r.domain, 'primary_website', 'unknown', 'wikidata-p856'
from public.companies as c
join public.company_directory_seed_retired as r on r.slug = c.slug
where c.slug in ('google', 'microsoft', 'apple', 'netflix', 'spotify', 'stripe',
                 'shopify', 'adobe', 'amazon', 'trustpilot', 'oracle');

-- The one company that is not from the seed. It must survive untouched, and it
-- also grants the delegation below, so the delegation guards exactly one row.
insert into public.companies (name, slug, source)
values ('Retirement Bystander', 'retirement-bystander', 'curated');

insert into public.company_domains (company_id, domain, domain_type, evidence_confidence, source)
select c.id, 'bystander.test', 'primary_website', 'medium', 'curated'
from public.companies as c where c.slug = 'retirement-bystander';

-- A company a member created whose slug collides with a seed name: the seed
-- inserts with `on conflict (slug) do nothing`, so this is the row that exists
-- and the seed's insert was skipped. It is not a seeded row, whatever its slug.
insert into public.companies (name, slug, created_by)
values ('Google', 'a-member-company', 'f0f0f0f0-0000-4000-8000-000000000001');

-- ─── One row per way to be touched ──────────────────────────

-- microsoft: a member joined it.
insert into public.company_members (company_id, user_id, verified)
select c.id, 'f0f0f0f0-0000-4000-8000-000000000001', true
from public.companies as c where c.slug = 'microsoft';

-- apple: a challenge is open against it.
insert into public.company_email_verifications
  (user_id, company_id, company_name, domain, work_email, code_hash, expires_at)
select 'f0f0f0f0-0000-4000-8000-000000000003', c.id, c.name, 'apple.com',
       'someone@apple.com', 'hash', now() + interval '10 minutes'
from public.companies as c where c.slug = 'apple';

-- netflix: a member's profile points at it.
update public.designer_profiles
set company_id = (select id from public.companies where slug = 'netflix')
where user_id = 'f0f0f0f0-0000-4000-8000-000000000003';

-- spotify: it owns a domain somebody proved.
update public.company_domains
set verified = true, verified_at = now()
where domain = 'spotify.com';

-- stripe: an operator reviewed it.
insert into public.company_domain_reviews
  (domain, company_id, reviewer_id, decision, reason, before_confidence, after_confidence)
select 'stripe.com', c.id, 'f0f0f0f0-0000-4000-8000-000000000002',
       'reject', 'reviewed during the retirement test', 'low', null
from public.companies as c where c.slug = 'stripe';

-- shopify: a delegation names it.
insert into public.company_domain_delegations (company_id, domain, granted_by, evidence, review_status, reviewed_at)
select c.id, 'shopify.com', g.id, '[]'::jsonb, 'unreviewed', null
from public.companies as c
cross join public.companies as g
where c.slug = 'shopify' and g.slug = 'retirement-bystander';

-- adobe: it carries an observation.
insert into public.domain_evidence (company_id, domain, evidence_type, source_url, source, checked)
select c.id, 'adobe.com', 'first_party_legal_page', 'https://www.adobe.com/legal/', 'resolver', true
from public.companies as c where c.slug = 'adobe';

-- amazon: another layer owns it.
update public.companies
set source = 'companies_house', source_id = '01234567', jurisdiction = 'GB'
where slug = 'amazon';


-- ─── 1. The identification ──────────────────────────────────

select is(
  (select count(*)::int from public.company_directory_seed_retired),
  4574,
  'the retired seed is recorded in full: 4,574 names, domains and slugs'
);

select is(
  (select slug from public.company_directory_seed_retired where name = 'Google'),
  'google',
  'the recorded slug is the database''s own company_slugify of the seed''s name'
);

select is(
  (select string_agg(plan.slug, ',' order by plan.slug)
     from public.company_directory_seed_retirement_plan() as plan
    where plan.disposable
      and plan.slug in ('google', 'microsoft', 'apple', 'netflix', 'spotify',
                        'stripe', 'shopify', 'adobe', 'amazon', 'trustpilot', 'oracle')),
  'google,oracle,trustpilot',
  'only the seed rows nobody has touched are disposable'
);

select is(
  (select count(*)::int from public.company_directory_seed_retirement_plan() as plan
    where plan.slug = 'a-member-company'),
  0,
  'a company a member created is not a seed row, even when its name matches one'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'microsoft'),
  'member_joined',
  'a member''s membership keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'apple'),
  'member_verification',
  'an open verification challenge keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'netflix'),
  'member_profile_points_at_it',
  'a member''s profile pointer keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'spotify'),
  'owns_a_verified_domain',
  'owning a proved domain keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'stripe'),
  'operator_reviewed',
  'an operator''s decision keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'shopify'),
  'delegation_names_it',
  'a delegation keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'adobe'),
  'carries_observations',
  'an observation keeps the company'
);

select is(
  (select reason from public.company_directory_seed_retirement_plan() as plan where plan.slug = 'amazon'),
  'another_layer_owns_it',
  'a registry identity keeps the company'
);

select is(
  (select count(*)::int from public.company_directory_seed_retained),
  8,
  'the retained view lists exactly the seed rows a guard keeps'
);

select is(
  (select count(*)::int from public.company_directory_seed_retirement_plan() as plan
    where plan.slug = 'retirement-bystander'),
  0,
  'a company outside the seed list is not a candidate at all'
);

-- ─── 2. The dry run ─────────────────────────────────────────

select is(
  (select row(d.companies_removed, d.claims_removed, d.dry_run)
     from public.retire_company_directory_seed(true) as d),
  row(3::bigint, 3::bigint, true),
  'the dry run reports what it would remove'
);

select is(
  (select count(*)::int from public.companies
    where slug in ('google', 'oracle', 'trustpilot')),
  3,
  'and removes nothing'
);

-- ─── 3. The removal ─────────────────────────────────────────

select is(
  (select row(d.companies_removed, d.claims_removed, d.dependents_removed, d.companies_retained, d.dry_run)
     from public.retire_company_directory_seed(false) as d),
  row(3::bigint, 3::bigint, 0::bigint, 8::bigint, false),
  'the removal takes the untouched seeded rows, their claims, and nothing else'
);

select is(
  (select count(*)::int from public.companies
    where slug in ('google', 'oracle', 'trustpilot')),
  0,
  'the untouched seeded companies are gone'
);

select is(
  (select count(*)::int from public.company_domains
    where domain in ('google.com', 'oracle.com', 'trustpilot.com')),
  0,
  'and so are their claims'
);

select is(
  (select count(*)::int from public.companies
    where slug in ('microsoft', 'apple', 'netflix', 'spotify', 'stripe', 'shopify', 'adobe', 'amazon')),
  8,
  'every company a guard named is still there'
);

select is(
  (select count(*)::int from public.companies
    where slug in ('microsoft', 'apple', 'netflix', 'spotify', 'stripe', 'shopify', 'adobe', 'amazon')
      and created_by is null),
  8,
  'and none of them was deleted behind the guard'
);

-- ─── 4. What was not touched ────────────────────────────────

select is(
  (select count(*)::int from public.companies where slug = 'retirement-bystander'),
  1,
  'a company outside the seed survives'
);

select is(
  (select count(*)::int from public.company_domains where domain = 'bystander.test'),
  1,
  'and keeps its claim'
);

select is(
  (select count(*)::int from public.companies where slug = 'a-member-company'),
  1,
  'a member''s company survives even when it shares a seed name'
);

select is(
  (select verified from public.company_domains where domain = 'spotify.com'),
  true,
  'a proved domain stays proved'
);

select is(
  (select verified from public.company_domains where domain = 'microsoft.com'),
  false,
  'and an unproved claim is not turned into a proof by the transition'
);

select is(
  (select count(*)::int from public.company_members
    where user_id = 'f0f0f0f0-0000-4000-8000-000000000001'),
  1,
  'the membership survives'
);

select is(
  (select count(*)::int from public.company_email_verifications
    where user_id = 'f0f0f0f0-0000-4000-8000-000000000003'),
  1,
  'the verification record survives'
);

select is(
  (select count(*)::int from public.designer_profiles
    where user_id = 'f0f0f0f0-0000-4000-8000-000000000003' and company_id is not null),
  1,
  'the profile pointer survives'
);

select is(
  (select count(*)::int from public.company_domain_reviews where domain = 'stripe.com'),
  1,
  'the operator decision survives'
);

select is(
  (select count(*)::int from public.company_domain_delegations where domain = 'shopify.com'),
  1,
  'the delegation survives'
);

select is(
  (select count(*)::int from public.domain_evidence where domain = 'adobe.com'),
  1,
  'the observation survives'
);

select is(
  (select count(*)::int from public.users where email like '%@seed-retirement.test'),
  3,
  'no user was deleted'
);

-- ─── 5. Nothing is left dangling, and reruns change nothing ─

select is(
  (select count(*)::int
     from public.company_domains as cd
     left join public.companies as c on c.id = cd.company_id
    where c.id is null),
  0,
  'no claim is orphaned by the removal'
);

select is(
  (select count(*)::int
     from public.domain_evidence as e
     left join public.companies as c on c.id = e.company_id
    where c.id is null),
  0,
  'no observation is orphaned either'
);

select is(
  (select d.companies_removed from public.retire_company_directory_seed(false) as d),
  0::bigint,
  'a second run deletes nothing: the transition is idempotent'
);

select is(
  (select d.companies_removed from public.retire_company_directory_seed(false) as d),
  0::bigint,
  'and a third run still deletes nothing'
);

select is(
  (select count(*)::int from public.company_directory_seed_retained),
  8,
  'the retained view is unchanged by the reruns'
);

select is(
  (select count(*)::int from public.company_directory_seed_retired),
  4574,
  'the record of what was retired is not written to again'
);

-- ─── 6. It is not an anonymous door ─────────────────────────

select is(
  has_function_privilege('anon', 'public.retire_company_directory_seed(boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.retire_company_directory_seed(boolean)', 'execute')
    or has_function_privilege('anon', 'public.company_directory_seed_retirement_plan()', 'execute')
    or has_function_privilege('authenticated', 'public.company_directory_seed_retirement_plan()', 'execute'),
  false,
  'no client role can plan or run the removal'
);

select is(
  has_function_privilege('service_role', 'public.retire_company_directory_seed(boolean)', 'execute')
    and has_function_privilege('service_role', 'public.company_directory_seed_retirement_plan()', 'execute'),
  true,
  'while the service role can plan it and run it'
);

select is(
  has_table_privilege('anon', 'public.company_directory_seed_retired', 'SELECT')
    or has_table_privilege('authenticated', 'public.company_directory_seed_retained', 'SELECT'),
  false,
  'and neither the record nor the retained list is readable by a client role'
);

-- ─── Cleanup ────────────────────────────────────────────────

delete from public.companies
 where slug in ('microsoft', 'apple', 'netflix', 'spotify', 'stripe', 'shopify',
                'adobe', 'amazon', 'retirement-bystander', 'a-member-company');
delete from public.users where email like '%@seed-retirement.test';

select * from finish();
