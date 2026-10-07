-- ============================================================
-- Curating the picker's first screen from the admin page
--
-- Migration under test: 20261007160000_company_directory_featured_admin.sql
--
-- The design block (20261007150000) is what a designer sees when the picker
-- opens. This file proves an admin can curate it — feature a company, move it,
-- take it out — and that every one of those edits leaves the block as what it
-- claims to be: the first N companies the picker shows, 1..N with no ties, no
-- gaps, and no hidden company in it.
--
-- Sections 1-3 read the state the migrations left. Section 4 mutates it inside a
-- transaction it rolls back, so the seeded block survives for the next file.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(33);

-- ─── 1. The block, as the admin page reads it ───────────────

select has_function('public', 'admin_featured_companies', 'the admin page can read the block');
select has_function('public', 'admin_set_company_featured', 'it can feature and unfeature');
select has_function('public', 'admin_move_company_featured', 'it can reorder it');

select is(
  (select count(*)::int from public.admin_featured_companies()),
  35,
  'the curated block is what the admin page sees'
);

select is(
  (select string_agg(position::text, ',' order by position)
     from public.admin_featured_companies()),
  (select string_agg(g::text, ',' order by g) from generate_series(1, 35) as g),
  'the block reads 1..35: no gaps and no two companies in one position'
);

select is(
  (select f.name from public.admin_featured_companies() as f where f.position = 1),
  'Figma',
  'the admin page and the picker agree on who leads'
);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Figma',
  'and the picker shows exactly that company first'
);

-- ─── 2. Only the admin route can reach it ───────────────────

select is(
  has_function_privilege('anon', 'public.admin_featured_companies()', 'EXECUTE'),
  false,
  'an unauthenticated session cannot read the block'
);

select is(
  has_function_privilege('anon', 'public.admin_set_company_featured(uuid, boolean)', 'EXECUTE'),
  false,
  'nor feature itself into it'
);

select is(
  has_function_privilege('service_role', 'public.admin_set_company_featured(uuid, boolean)', 'EXECUTE'),
  true,
  'the service role the admin route uses can'
);

select is(
  has_function_privilege('service_role', 'public.company_featured_renumber()', 'EXECUTE'),
  false,
  'the renumber helper is not reachable through the API at all'
);

-- ─── 3. The list reports the position ───────────────────────

select is(
  (select l.featured_rank from public.admin_list_companies('figma', true, 5, 0) as l where l.name = 'Figma'),
  1,
  'the company list shows a company''s position in the block'
);

select is(
  (select l.featured_rank from public.admin_list_companies('3M', true, 5, 0) as l where l.name = '3M'),
  null,
  'and null for a company that is not in it'
);

select is(
  (select count(*)::int from public.admin_list_companies('', false, 1000, 0)),
  (select count(*)::int from public.companies where is_active),
  'the list returns every active company, not the first 500 of them'
);

-- ─── 4. Curating it ─────────────────────────────────────────

begin;

select is(
  public.admin_set_company_featured(
    (select c.id from public.companies as c where c.name = '3M'), true
  ),
  36,
  'featuring a company puts it at the end of the block'
);

select is(
  (select count(*)::int from public.admin_featured_companies()),
  36,
  'and the block grew by one'
);

select is(
  (select f.name from public.admin_featured_companies() as f where f.position = 36),
  '3M',
  'at position 36'
);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Figma',
  'a new arrival at the end does not disturb the first screen'
);

select is(
  public.admin_set_company_featured(
    (select c.id from public.companies as c where c.name = '3M'), true
  ),
  36,
  'featuring it again changes nothing and reports the same position'
);

select is(
  public.admin_set_company_featured(
    (select c.id from public.companies as c where c.name = '3M'), false
  ),
  null,
  'unfeaturing it returns no position'
);

select is(
  (select count(*)::int from public.admin_featured_companies()),
  35,
  'and the block closes the gap it left'
);

select is(
  public.admin_move_company_featured(
    (select c.id from public.companies as c where c.name = 'Adobe'), -1
  ),
  1,
  'moving a company earlier swaps it with its neighbour'
);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Adobe',
  'and the picker''s first row follows the block'
);

select is(
  public.admin_move_company_featured(
    (select c.id from public.companies as c where c.name = 'Adobe'), 1
  ),
  2,
  'moving it later swaps it back'
);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Figma',
  'so the picker leads with Figma again'
);

select is(
  public.admin_move_company_featured(
    (select c.id from public.companies as c where c.name = 'Figma'), -1
  ),
  1,
  'moving the first company earlier is a no-op, not an error'
);

select throws_ok(
  $$ select public.admin_move_company_featured(
       (select c.id from public.companies as c where c.name = '3M'), 1) $$,
  'P0001',
  'company_not_featured',
  'a company outside the block cannot be reordered within it'
);

select throws_ok(
  $$ select public.admin_move_company_featured(
       (select c.id from public.companies as c where c.name = 'Figma'), 0) $$,
  '22023',
  'invalid_direction',
  'a direction other than earlier or later is refused'
);

select public.admin_update_company(
  (select c.id from public.companies as c where c.name = '3M'),
  p_is_active => false
);

select throws_ok(
  $$ select public.admin_set_company_featured(
       (select c.id from public.companies as c where c.name = '3M'), true) $$,
  'P0001',
  'company_inactive',
  'a hidden company cannot be featured: the picker would never show it'
);

select public.admin_update_company(
  (select c.id from public.companies as c where c.name = 'Figma'),
  p_is_active => false
);

select is(
  (select count(*)::int from public.admin_featured_companies()),
  34,
  'deactivating a featured company takes it out of the block'
);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Adobe',
  'and the picker moves on to the next company rather than a hole'
);

select public.admin_delete_company(
  (select c.id from public.companies as c where c.name = 'Adobe')
);

select is(
  (select s.name from public.search_companies('', 1) as s),
  'Canva',
  'deleting a featured company closes its position too'
);

select is(
  (select string_agg(position::text, ',' order by position)
     from public.admin_featured_companies()),
  (select string_agg(g::text, ',' order by g) from generate_series(1, 33) as g),
  'after a removal, a deactivation and a delete the block is still 1..33'
);

rollback;

select * from finish();
