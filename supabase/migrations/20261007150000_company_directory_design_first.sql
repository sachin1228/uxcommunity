-- ============================================================
-- Migration: design companies first on the picker's first screen
--
-- WHY
--   The "Where do you work?" picker opens on an empty box, and an empty query is
--   answered by browsing the directory in name order. Against the curated list
--   that first screen was `3M, ABB, AbbVie, Abstract, Accenture` — the top
--   corner of a directory nobody is looking for. A designer who opens that box
--   is almost always looking for a design tool, a design studio or a design-led
--   employer, so those are what it shows first.
--
-- HOW
--   `companies.featured_rank`: a nullable integer holding a position in the
--   curated design block, hand-picked in
--   data/company-directory/mnc-companies.json (`featured`). The node test
--   scripts/generate-company-directory-mnc-seed.test.mjs asserts this file
--   marks exactly those companies, in that order.
--
--   Deliberately NOT `directory_rank`: that column already means something the
--   import derives and recomputes (evidence first, then confidence, then
--   notability — see docs/company-data-quality.md §6). Writing a curation order
--   into it would corrupt a meaning another layer owns.
--
--   The empty-query branch of `search_companies` becomes two bounded arms: the
--   featured rows by curated rank, then everything else by name. Two arms rather
--   than one `order by featured_rank nulls last, name` because that single
--   ORDER BY cannot use `companies_active_name_idx` at all: the browse arm would
--   have to sort every active company — 500,000 rows once the import lands —
--   before the LIMIT could discard any of them. Each arm below stays an index
--   walk, and the featured arm is 35 rows by construction.
--
--   The other two branches of search are untouched: a designer who types "fig"
--   gets Figma because of its name, not because of the curation.
--
-- REVERSIBLE
--   `update public.companies set featured_rank = null` is the entire rollback.
--   Nothing else reads the column, and the picker browses in name order again.
-- ============================================================

-- ─── Preconditions ──────────────────────────────────────────

-- This file marks rows in `companies` and replaces `search_companies`, which is
-- built on the stewardship helpers. Say which migrations to apply rather than
-- failing on the first reference to something that does not exist yet.
do $design_first_preconditions$
begin
  if to_regclass('public.companies') is null
     or to_regprocedure('public.company_slugify(text)') is null
     or to_regprocedure('public.company_search_term(text)') is null
     or to_regprocedure('public.company_confidence_rank(text)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'design_first_needs_directory_schema',
      hint = 'apply 20260929120000_company_verified_domains.sql, then 20260929130000_company_directory_hints.sql, then 20260929150000_company_domain_stewardship.sql before this';
  end if;
end
$design_first_preconditions$;


-- ─── The marker: a position in the design block ─────────────

-- Nullable, not a boolean: the block's ORDER is part of the curation (Figma
-- first, then Adobe, …), and 1..N says it in one column. A row with no
-- featured_rank is an ordinary directory row.
alter table public.companies
  add column if not exists featured_rank integer;

-- Dropped before it is added, so re-applying the file on a database that already
-- ran an earlier draft cannot fail on the constraint's name.
alter table public.companies
  drop constraint if exists companies_featured_rank_check,
  add constraint companies_featured_rank_check check (featured_rank is null or featured_rank >= 1);

comment on column public.companies.featured_rank is
  'Position in the curated design-first block that the picker''s empty query leads with. NULL (the default) means not featured: the row browses in name order after the block. Hand-curated — unlike directory_rank, which the import derives from evidence.';

-- Partial, because every query that reads it asks for featured rows only, and
-- ordered by rank, because that IS the order those rows are returned in.
create index if not exists companies_featured_rank_idx
  on public.companies (featured_rank)
  where featured_rank is not null;


-- ─── Marking the curated design companies ───────────────────

-- The list is repeated here as (name, rank) rather than referenced from the
-- seed migration, because a migration must be readable and applicable on its
-- own. What keeps the two in step is the node test: it reads this file, reads
-- data/company-directory/mnc-companies.json, and fails if the names or their
-- order disagree with the `featured` array.
do $design_first$
declare
  v_marked  integer;
  v_missing text;
begin
  create temporary table _design_first (
    name text not null,
    rank integer not null
  ) on commit drop;

  insert into _design_first (name, rank) values
    ('Figma', 1),
    ('Adobe', 2),
    ('Canva', 3),
    ('InVision', 4),
    ('Sketch', 5),
    ('Framer', 6),
    ('Miro', 7),
    ('Zeplin', 8),
    ('Abstract', 9),
    ('Balsamiq', 10),
    ('Marvel App', 11),
    ('LottieFiles', 12),
    ('Envato', 13),
    ('Awwwards', 14),
    ('Behance', 15),
    ('Dribbble', 16),
    ('Maze', 17),
    ('UserTesting', 18),
    ('IDEO', 19),
    ('frog design', 20),
    ('Pentagram', 21),
    ('Landor', 22),
    ('R/GA', 23),
    ('Huge', 24),
    ('Wieden+Kennedy', 25),
    ('Ogilvy', 26),
    ('Publicis Groupe', 27),
    ('WPP', 28),
    ('Omnicom Group', 29),
    ('Dentsu', 30),
    ('Interpublic Group', 31),
    ('TBWA', 32),
    ('BBDO', 33),
    ('Droga5', 34),
    ('Autodesk', 35);

  -- The slug comes from the database's own immutable company_slugify(), the same
  -- function that named the seeded row's slug, so this file cannot disagree with
  -- the seed about which row "Figma" is.
  --
  -- A featured name that matches no company would silently leave a hole at the
  -- top of the picker, which is the one outcome this migration exists to
  -- prevent; it fails the migration instead, and names the offenders.
  select string_agg(d.name, ', ' order by d.rank)
    into v_missing
    from _design_first as d
    left join public.companies as c on c.slug = public.company_slugify(d.name)
   where c.id is null;

  if v_missing is not null then
    raise exception using
      errcode = 'P0001',
      message = 'design_first_company_missing',
      detail = v_missing,
      hint = 'add the company to data/company-directory/mnc-companies.json, or fix the name here, then re-run this migration';
  end if;

  update public.companies as c
     set featured_rank = d.rank
    from _design_first as d
   where c.slug = public.company_slugify(d.name)
     and c.featured_rank is distinct from d.rank;
  get diagnostics v_marked = row_count;

  raise notice 'design first: % companies marked', v_marked;
end
$design_first$;


-- ─── search_companies, now design-first when browsing ───────

create or replace function public.search_companies(
  p_query text,
  p_limit integer default 10
)
returns table (
  id                  uuid,
  name                text,
  slug                text,
  logo_url            text,
  domain              text,
  verified            boolean,
  member_count        bigint,
  evidence_confidence text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Escaped for LIKE, and a lowercased copy for the domain/slug arms (the
  -- stored forms are already lowercase, and `ilike` cannot use a btree).
  v_term  text := public.company_search_term(p_query);
  v_lower text := lower(public.company_search_term(p_query));
  v_max   integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  -- An empty query browses the directory instead of returning nothing, and the
  -- curated design block leads that browse.
  --
  -- Two arms, each bounded by `v_max` and each an index walk: the featured rows
  -- in curated rank order (companies_featured_rank_idx), then everything else by
  -- name (companies_active_name_idx), folded back together in arm order. The
  -- one-arm form — `order by c.featured_rank nulls last, c.name` — has to sort
  -- every active company before the LIMIT can discard any of them, which is the
  -- cost this shape exists to avoid at 500,000 rows.
  if v_term = '' then
    return query
    with browse as (
      (select c.id as company_id, 0 as arm, c.featured_rank as arm_rank
       from public.companies as c
       where c.is_active and c.featured_rank is not null
       order by c.featured_rank asc
       limit v_max)
      union all
      (select c.id, 1, null::integer
       from public.companies as c
       where c.is_active and c.featured_rank is null
       order by c.name asc
       limit v_max)
    )
    select
      c.id, c.name, c.slug, c.logo_url,
      dom.domain,
      coalesce(dom.verified, false),
      (select count(*) from public.company_members as m
        where m.company_id = c.id and m.verified),
      dom.evidence_confidence
    from browse as b
    join public.companies as c on c.id = b.company_id
    left join lateral (
      select d.domain, d.verified, d.evidence_confidence
      from public.company_domains as d
      where d.company_id = c.id
      order by d.verified desc,
               public.company_confidence_rank(d.evidence_confidence) desc,
               d.created_at asc,
               d.domain asc
      limit 1
    ) as dom on true
    order by b.arm asc, b.arm_rank asc nulls last, c.name asc
    limit v_max;
    return;
  end if;

  if length(v_lower) < 3 then
    -- A prefix search: one or two characters are a start-of-name lookup, not a
    -- substring one, so each arm is anchored and every arm is index-backed.
    return query
    with matched as (
      -- Ordered by lower(name) because that is the index
      -- (companies_name_lower_prefix_idx): the range scan and the ordering are
      -- the same walk, so the arm stops as soon as it has 25.
      (select c.id as company_id, 0 as arm, true as name_prefix
       from public.companies as c
       where c.is_active and lower(c.name) like v_lower || '%'
       order by lower(c.name) asc
       limit v_max)
      union all
      (select c.id, 1, false
       from public.companies as c
       where c.is_active and c.slug like v_lower || '%'
       order by c.name asc
       limit v_max)
      union all
      (select d.company_id, 3, false
       from public.company_domains as d
       join public.companies as dc on dc.id = d.company_id and dc.is_active
       where d.domain like v_lower || '%'
       order by d.domain asc
       limit v_max)
    ), scored as (
      select company_id, min(arm) as arm, bool_or(name_prefix) as name_prefix
      from matched
      group by company_id
    )
    select
      c.id, c.name, c.slug, c.logo_url,
      dom.domain,
      coalesce(dom.verified, false),
      (select count(*) from public.company_members as m
        where m.company_id = c.id and m.verified),
      dom.evidence_confidence
    from scored as s
    join public.companies as c on c.id = s.company_id
    left join lateral (
      select d.domain, d.verified, d.evidence_confidence
      from public.company_domains as d
      where d.company_id = c.id
      order by d.verified desc,
               public.company_confidence_rank(d.evidence_confidence) desc,
               d.created_at asc,
               d.domain asc
      limit 1
    ) as dom on true
    order by s.name_prefix desc, coalesce(dom.verified, false) desc, c.name asc
    limit v_max;
    return;
  end if;

  -- Three characters or more: substring arms, each on its own index.
  --
  -- Every arm is BOUNDED by `v_max` and ordered by name inside itself. Two
  -- reasons, and both are about a big directory:
  --
  --   * an arm of a UNION ALL that has no limit of its own has to produce every
  --     match before the outer LIMIT can discard them, so a term matching 5% of
  --     500,000 rows makes the whole search cost that 5% — measured at 64 ms for
  --     a 5%-common name and 153 ms for a broad one at 100,000 rows;
  --   * the arms are ordered by WHERE THE MATCH IS (`strpos`), then by name,
  --     which keeps the 25 that survive deterministic without asking the planner
  --     for an ordering the trigram index cannot provide. Ordering by name
  --     instead makes the plan walk the name index and throw rows away until it
  --     finds 25 matches: measured at 500,000 rows that is 169–185 ms, against
  --     82 ms for the unordered bitmap, because the matches it needs are late in
  --     alphabetical order. `strpos` ranks a name starting with the term above
  --     one that contains it, which is also the better answer.
  --
  -- What this does not fix, deliberately: a term like 'ent' still matches a large
  -- share of the directory, and any search that must look inside every name pays
  -- for the matches it finds. The picker's interactive path is protected by the
  -- 2-character rule above (prefix only) and by the client's debounce; the honest
  -- numbers per tier are in docs/company-directory-architecture.md §11.
  return query
  with matched as (
    (select c.id as company_id, 0 as arm, (c.name ilike v_term || '%') as name_prefix
     from public.companies as c
     where c.is_active and c.name ilike '%' || v_term || '%'
     order by strpos(lower(c.name), v_lower), c.name asc
     limit v_max)
    union all
    (select c.id, 1, false
     from public.companies as c
     where c.is_active and c.slug ilike '%' || v_lower || '%'
     order by strpos(lower(c.slug), v_lower), c.slug asc
     limit v_max)
    union all
    (select a.company_id, 2, false
     from public.company_aliases as a
     join public.companies as ac on ac.id = a.company_id and ac.is_active
     where a.alias ilike '%' || v_term || '%'
     order by strpos(lower(a.alias), v_lower), a.alias asc
     limit v_max)
    union all
    -- Verified domains only: typing a domain asks "who owns this?", and a hint
    -- owns nothing. A hint is still reachable by the company's name.
    (select d.company_id, 3, false
     from public.company_domains as d
     join public.companies as dc on dc.id = d.company_id and dc.is_active
     where d.verified and d.domain like v_lower || '%'
     order by d.domain asc
     limit v_max)
  ), scored as (
    select company_id, min(arm) as arm, bool_or(name_prefix) as name_prefix
    from matched
    group by company_id
  )
  select
    c.id, c.name, c.slug, c.logo_url,
    dom.domain,
    coalesce(dom.verified, false),
    (select count(*) from public.company_members as m
      where m.company_id = c.id and m.verified),
    dom.evidence_confidence
  from scored as s
  join public.companies as c on c.id = s.company_id
  left join lateral (
    select d.domain, d.verified, d.evidence_confidence
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as dom on true
  order by s.name_prefix desc, coalesce(dom.verified, false) desc, c.name asc
  limit v_max;
end;
$$;

comment on function public.search_companies(text, integer) is
  'Directory search by name, slug, alias or verified domain, each arm index-backed. An empty query browses the directory with the curated design block first (companies.featured_rank), then name order. Reports the company''s primary domain (verified first, then the strongest claim) with `verified` and `evidence_confidence` so a caller can tell a proof from a hint.';


-- ─── Execute grants ─────────────────────────────────────────

revoke all on function public.search_companies(text, integer) from public, anon, authenticated;
grant execute on function public.search_companies(text, integer) to service_role;
