-- ============================================================================
-- How fast is the "Where do you work?" picker at 1k / 10k / 100k / 500k rows?
--
--   psql -v n=1000   -f scripts/bench-company-search.sql
--   psql -v n=10000  -f scripts/bench-company-search.sql
--   psql -v n=100000 -f scripts/bench-company-search.sql
--   psql -v n=500000 -f scripts/bench-company-search.sql
--
-- WHY THIS EXISTS
--   `public.search_companies` (see
--   supabase/migrations/20260929130000_company_directory_hints.sql) answers the
--   picker with `name ILIKE '%term%'`, which no ordinary index can serve. That
--   is fine at the 4,574 rows the directory seeds today and unmeasured
--   everywhere else, and a directory of half a million companies turns the
--   guess into a decision. This file builds the same SHAPES on synthetic rows
--   and times them, so the next schema change is argued from numbers.
--
-- WHAT IT BUILDS
--   Everything lives in the `bench` schema and is dropped on the next run, so
--   this never touches `public`. Columns, the partial unique index on verified
--   domains and the `lower(name)` index are the real ones; `member_count` is
--   the same correlated subquery, against an empty membership table (real
--   memberships are far too few to change the plan).
--
-- HOW TO READ THE OUTPUT
--   `bench.timings` has one row per (phase, query): milliseconds per run,
--   median of five, after a warm-up run. The three phases answer three
--   different questions:
--     A  the schema as it exists today
--     B  plus a trigram index on the searched columns
--     C  plus the ordering index the browser query needs
--
-- NOTES
--   The synthetic names are drawn from a small word pool, so `fig` matches a
--   realistic handful and `a` matches a realistic share; the point is the plan
--   shape, not the exact selectivity.
-- ============================================================================

\set ON_ERROR_STOP on
\if :{?n}
\else
  \set n 10000
\endif

drop schema if exists bench cascade;
create schema bench;
create extension if not exists pg_trgm;

-- ─── The tables under test ─────────────────────────────────────────────────

create table bench.companies (
  id         serial primary key,
  name       text not null,
  slug       text not null unique,
  logo_url   text,
  is_active  boolean not null default true
);

create table bench.company_domains (
  id          serial primary key,
  company_id  integer not null references bench.companies (id) on delete cascade,
  domain      text not null,
  verified    boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

create table bench.company_members (
  id         serial primary key,
  company_id integer not null references bench.companies (id) on delete cascade,
  user_id    integer not null,
  verified   boolean not null default false
);

create index idx_companies_name on bench.companies (lower(name));
create unique index company_domains_verified_domain_idx
  on bench.company_domains (domain) where verified;
create index idx_company_domains_company on bench.company_domains (company_id);
create index idx_company_members_company on bench.company_members (company_id);

-- ─── Synthetic rows ───────────────────────────────────────────────────────
-- One company per row, one domain row per company: the seed writes a single
-- hint each, and a second domain multiplies the domain search arm only.

insert into bench.companies (name, slug)
select
  initcap(pool.a) || ' ' || initcap(pool.b) ||
    case when g % 7 = 0 then ' Technologies' when g % 11 = 0 then ' Group' else ' ' || initcap(pool.c) end
    || ' ' || g as name,
  'company-' || g as slug
from generate_series(1, :n) as g
cross join lateral (
  select
    (array['acme','figma','vertex','lumen','north','bright','quantum','meridian','helio','cobalt',
           'astra','zenith','orbit','delta','summit','iron','silver','harbor','nova','pioneer'])[1 + (g * 3) % 20] as a,
    (array['labs','systems','works','data','media','soft','tek','logistics','retail','capital',
           'health','energy','foods','motors','bank','air','rail','steel','textile','pharma'])[1 + (g * 7) % 20] as b,
    (array['india','global','holdings','partners','ventures','international','solutions','services',
           'industries','enterprises'])[1 + (g * 13) % 10] as c
) as pool;

insert into bench.company_domains (company_id, domain, verified)
select id, slug || '.com', false from bench.companies;
-- A hundred proved domains, so the verified-preferring ordering has real rows
-- to distinguish rather than an empty branch.
update bench.company_domains as d
set verified = true, verified_at = now()
where d.id % 5000 = 0;

analyze bench.companies;
analyze bench.company_domains;
analyze bench.company_members;

-- ─── The queries, copied from search_companies ────────────────────────────

create table bench.timings (
  phase   text,
  query   text,
  n       integer,
  ms      numeric,
  runs    integer
);

create or replace function bench.time_it(p_phase text, p_query text, p_sql text)
returns void
language plpgsql
as $$
declare
  timings numeric[] := '{}';
  t0      timestamptz;
  i       integer;
  cnt     bigint;
begin
  -- Warm-up: first execution pays for cache, plan and JIT.
  execute p_sql;
  for i in 1..5 loop
    t0 := clock_timestamp();
    execute p_sql;
    timings := timings || round(extract(epoch from clock_timestamp() - t0) * 1000, 3);
  end loop;
  select percentile_cont(0.5) within group (order by t) into cnt from unnest(timings) as t;
  insert into bench.timings values (p_phase, p_query, current_setting('bench.n')::integer, cnt, 5);
end;
$$;

create or replace function bench.searched_name(p_like text)
returns table (id integer, name text, slug text, logo_url text, domain text, verified boolean, member_count bigint)
language sql
stable
as $$
  select
    c.id, c.name, c.slug, c.logo_url, domain_row.domain,
    coalesce(domain_row.verified, false),
    (select count(*) from bench.company_members as m where m.company_id = c.id and m.verified)
  from bench.companies as c
  left join lateral (
    select d.domain, d.verified
    from bench.company_domains as d
    where d.company_id = c.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as domain_row on true
  where c.is_active
    and (c.name ilike p_like or c.slug ilike p_like
         or exists (select 1 from bench.company_domains as d
                    where d.company_id = c.id and d.verified and d.domain ilike p_like))
  order by (c.name ilike replace(replace(p_like, '%', ''), '\', '') || '%') desc, c.name asc
  limit 25;
$$;

create or replace function bench.browsed()
returns table (id integer, name text, slug text, logo_url text, domain text, verified boolean, member_count bigint)
language sql
stable
as $$
  select
    c.id, c.name, c.slug, c.logo_url, domain_row.domain,
    coalesce(domain_row.verified, false),
    (select count(*) from bench.company_members as m where m.company_id = c.id and m.verified)
  from bench.companies as c
  left join lateral (
    select d.domain, d.verified
    from bench.company_domains as d
    where d.company_id = c.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as domain_row on true
  where c.is_active
  order by c.name asc
  limit 25;
$$;

-- ─── Phase A: today's schema ─────────────────────────────────────────────

select set_config('bench.n', :'n', false);

select bench.time_it('A today', 'browse (empty query)',
  'select * from bench.browsed()');
select bench.time_it('A today', 'name %lumen% (3 of 20 first words)',
  'select * from bench.searched_name(''%lumen%'')');
select bench.time_it('A today', 'name %a% (broad)',
  'select * from bench.searched_name(''%a%'')');
select bench.time_it('A today', 'name lumen% (prefix)',
  'select * from bench.searched_name(''lumen%'')');
select bench.time_it('A today', 'domain exact',
  'select * from bench.company_domains where domain = ''company-42.com''');
select bench.time_it('A today', 'domain %lumen%',
  'select * from bench.company_domains where domain ilike ''%lumen%''');

-- ─── Phase B: trigram indexes on the searched columns ────────────────────

create index companies_name_trgm_idx on bench.companies using gin (name gin_trgm_ops);
create index company_domains_domain_trgm_idx on bench.company_domains using gin (domain gin_trgm_ops);
create index companies_slug_trgm_idx on bench.companies using gin (slug gin_trgm_ops);
analyze bench.companies;
analyze bench.company_domains;

select bench.time_it('B trigram', 'browse (empty query)',
  'select * from bench.browsed()');
select bench.time_it('B trigram', 'name %lumen% (3 of 20 first words)',
  'select * from bench.searched_name(''%lumen%'')');
select bench.time_it('B trigram', 'name %a% (broad)',
  'select * from bench.searched_name(''%a%'')');
select bench.time_it('B trigram', 'name lumen% (prefix)',
  'select * from bench.searched_name(''lumen%'')');
select bench.time_it('B trigram', 'domain %lumen%',
  'select * from bench.company_domains where domain ilike ''%lumen%''');

-- ─── Phase C: plus the index the browse ordering needs ───────────────────
-- `order by name asc limit 25` cannot use `idx_companies_name` (that index is
-- on lower(name)), so an empty query reads and sorts the whole table.

create index companies_active_name_idx on bench.companies (is_active, name);
analyze bench.companies;

select bench.time_it('C browse idx', 'browse (empty query)',
  'select * from bench.browsed()');
select bench.time_it('C browse idx', 'name %lumen% (3 of 20 first words)',
  'select * from bench.searched_name(''%lumen%'')');
select bench.time_it('C browse idx', 'cardinality of the table',
  'select count(*) from bench.companies');

-- ─── Report ──────────────────────────────────────────────────────────────

\echo ''
\echo '── timings (ms, median of 5; table size in the n column) ──'
select phase, query, n, ms from bench.timings order by phase, query;

\echo ''
\echo '── plans (browse, and a substring name search) ──'
explain (analyze, buffers, costs off, summary off)
select * from bench.browsed();
explain (analyze, buffers, costs off, summary off)
select * from bench.searched_name('%lumen%');
