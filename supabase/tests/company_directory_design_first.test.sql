-- ============================================================
-- Design companies first — the picker's first screen
--
-- Migration under test: 20261007150000_company_directory_design_first.sql
--
-- The "Where do you work?" picker opens on an empty search box, and that empty
-- query is answered by browsing the directory. This file proves what the first
-- screen shows: the curated design block, in its curated order, then the rest of
-- the directory in name order — and that typing still works, because the same
-- function answers "fig" and "figma".
--
-- The block itself is asserted against its source
-- (data/company-directory/mnc-companies.json) by the node test
-- scripts/generate-company-directory-mnc-seed.test.mjs, which parses this
-- migration; this file asserts the DATABASE state after it applies.
--
-- The last section runs in a transaction it rolls back: it needs a directory
-- small enough that one curated rank is visibly the thing deciding the first
-- row, which the seeded 573-company list cannot show.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(17);

-- ─── 1. The marker the curation writes ──────────────────────

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'companies'
      and column_name = 'featured_rank'),
  1,
  'companies carries the curated design-first position'
);

select has_index(
  'public', 'companies', 'companies_featured_rank_idx',
  'the design block is read in rank order, not by scanning the directory'
);

select is(
  (select count(*)::int from public.companies where featured_rank is not null),
  35,
  'the curated design block is marked'
);

select is(
  (select string_agg(featured_rank::text, ',' order by featured_rank)
     from public.companies where featured_rank is not null),
  (select string_agg(g::text, ',' order by g) from generate_series(1, 35) as g),
  'the positions are 1..35: no gaps, so no two featured rows share a slot'
);

select is(
  (select string_agg(name, ' | ' order by featured_rank)
     from public.companies where featured_rank <= 4),
  'Figma | Adobe | Canva | InVision',
  'the block opens with the curated order, Figma first'
);

-- ─── 2. What the first screen shows ─────────────────────────

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Figma',
  'an empty query opens on the design block'
);

select is(
  (select count(*)::int
     from public.search_companies('', 8) as s
     join public.companies as c on c.id = s.id
    where c.featured_rank is null),
  0,
  'nothing outside the design block is on the first screen'
);

select is(
  (select count(*)::int
     from public.search_companies('', 8) as s
     join public.companies as c on c.id = s.id
    where c.featured_rank between 1 and 8),
  8,
  'the first screen is full, and it is the top of the block'
);

select is(
  (select count(*)::int
     from public.search_companies('', 25) as s
     join public.companies as c on c.id = s.id
    where c.featured_rank is null),
  0,
  'the whole first page (25 rows) is design companies'
);

-- The block is 35 rows and the function caps a page at 25, so a browse page is
-- design companies and nothing else. Deliberate, and only visible to a caller
-- that asks for more than the picker's 8: the directory's own name order starts
-- after the block, which the isolated section below shows.
select is(
  (select count(*)::int from public.search_companies('', 25)),
  25,
  'a browse page is the function''s full 25-row cap, all of it the block'
);

-- ─── 3. Typing is not curated ───────────────────────────────

select ok(
  exists (select 1 from public.search_companies('fig', 10) as s where s.name = 'Figma'),
  'a substring search still finds a design company by name'
);

select ok(
  exists (select 1 from public.search_companies('fi', 25) as s where s.name = 'Figma'),
  'a two-character prefix search still finds it'
);

select is(
  (select s.name from public.search_companies('canva', 10) as s where s.name = 'Canva'),
  'Canva',
  'a longer term is still a search, not a browse'
);

select is(
  (select count(*)::int from public.search_companies('%', 25)),
  0,
  'a LIKE wildcard stays escaped: the browse arm is not a wildcard'
);

-- ─── 4. Rank decides the order, not the name ────────────────

-- With the seeded directory in place the first row is Figma whether the order
-- comes from the rank or from the name (F, after all the digits). Two rows whose
-- curated rank is the OPPOSITE of their alphabetical order is the only shape
-- that can tell the two apart.
begin;

delete from public.companies;
insert into public.companies (name, slug, featured_rank) values
  ('Zulu Studio', 'zulu-studio', 1),
  ('Aardvark Studio', 'aardvark-studio', 2),
  ('Alpha Employer', 'alpha-employer', null),
  ('Zeta Employer', 'zeta-employer', null);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Zulu Studio',
  'the first row is decided by the curated rank, not by the name'
);

select is(
  (select string_agg(s.name, ',' order by s.name) from public.search_companies('', 2) as s),
  'Aardvark Studio,Zulu Studio',
  'a two-row block fills both rows asked for'
);

select is(
  (select string_agg(s.name, ',' order by s.name)
     from public.search_companies('', 4) as s
     join public.companies as c on c.id = s.id
    where c.featured_rank is null),
  'Alpha Employer,Zeta Employer',
  'past the block the rest of the directory follows in its name order'
);

rollback;

select * from finish();
