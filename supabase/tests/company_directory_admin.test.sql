-- ============================================================
-- Company directory — the admin operations
--
-- Migration under test: 20261007140000_company_directory_admin.sql
--
-- The admin Companies page and the "Where do you work?" picker read the same
-- two tables, so this file proves the admin path both works and stays inside
-- the trust model:
--
--   * the list returns the directory with each company's primary domain, its
--     proof flag, its domain and member counts, and a pagination total;
--   * creating a company writes its slug and, when given, exactly one
--     UNVERIFIED hint — an operator prepares a row, never a proof;
--   * a duplicate name, a duplicate domain, an invalid domain and a missing
--     name are all refused;
--   * deactivating a company hides it from the default list but not from the
--     p_all view the admin page uses.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(15);

-- ─── 1. The list ────────────────────────────────────────────

select ok(
  (select count(*) from public.admin_list_companies('', true, 500, 0)) >= 500,
  'the admin list returns the seeded directory'
);

select is(
  (select max(total_count) from public.admin_list_companies('', true, 50, 0)),
  (select count(*) from public.companies),
  'total_count counts every company, independent of the page size'
);

select ok(
  (select count(*) from public.admin_list_companies('figma', true, 500, 0) where name = 'Figma') = 1,
  'the admin list searches by name'
);

select is(
  (select domain from public.admin_list_companies('figma', true, 500, 0) where name = 'Figma'),
  'figma.com',
  'the admin list reports the primary domain'
);

select is(
  (select domain_verified from public.admin_list_companies('figma', true, 500, 0) where name = 'Figma'),
  false,
  'a seeded hint reads as unverified in the admin list'
);

-- ─── 2. Create ──────────────────────────────────────────────

select ok(
  (select count(*) from public.admin_create_company('Testco Admin', 'testco-admin.io')) = 1,
  'admin_create_company returns the new company'
);

select is(
  (select source from public.companies where slug = 'testco-admin'),
  'admin',
  'an admin-created company records its source'
);

select is(
  (select d.verified
     from public.company_domains as d
     join public.companies as c on c.id = d.company_id
    where c.slug = 'testco-admin' and d.domain = 'testco-admin.io'),
  false,
  'the admin-added domain is an unverified hint'
);

select ok(
  (select domain from public.admin_create_company('No Domain Co', null)) is null,
  'a company can be created without a domain'
);

-- ─── 3. The refusals ────────────────────────────────────────

select throws_ok(
  $sql$select * from public.admin_create_company('Testco Admin', 'other.io')$sql$,
  'P0001', '', 'a duplicate company name is refused'
);

select throws_ok(
  $sql$select * from public.admin_create_company('Another Co', 'testco-admin.io')$sql$,
  'P0001', '', 'a domain another company already holds is refused'
);

select throws_ok(
  $sql$select * from public.admin_create_company('Invalid Co', 'not a domain')$sql$,
  '22023', '', 'an invalid domain is refused'
);

select throws_ok(
  $sql$select * from public.admin_create_company('', 'blank.io')$sql$,
  '22023', '', 'a missing name is refused'
);

-- ─── 4. Deactivate hides, p_all shows ───────────────────────

update public.companies set is_active = false where slug = 'testco-admin';

select is(
  (select count(*)::int from public.admin_list_companies('Testco Admin', false, 500, 0)),
  0,
  'an inactive company is hidden from the default (active-only) list'
);

select is(
  (select count(*)::int from public.admin_list_companies('Testco Admin', true, 500, 0)),
  1,
  'p_all shows the inactive company so the admin can reactivate it'
);

-- ─── Fixtures ───────────────────────────────────────────────
delete from public.companies where slug in ('testco-admin', 'no-domain-co');

select * from finish();
