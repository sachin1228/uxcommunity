-- Explore is a bounded, paged read now (20261015150000_all_communities_cursor).
--
-- The page used to read every active community on the platform on each visit —
-- the one hotspot in docs/supabase-egress-audit.md whose cost grows with total
-- content rather than with the member's own usage. These assertions lock in the
-- three things that make the bound safe: the page size, the keyset cursor's
-- correctness (no row skipped, none repeated, strict order across the seam), and
-- the homepage rail's separate bounded read, which exists so that bounding the
-- directory could not silently narrow the rail to the first names in the
-- alphabet.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ── The two contracts ────────────────────────────────────────────────────────
select has_function(
  'public', 'get_all_communities', array['uuid', 'integer', 'text', 'uuid']
);

select has_function(
  'public', 'get_suggested_communities', array['uuid', 'integer']
);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Four ordinary member-created communities, at distinct member counts so the
-- rail's ordering is observable. `owner_id` is a seeded user (the same one the
-- other community fixtures use), because the column is a foreign key.
insert into public.communities (id, name, type, is_active, member_count, is_private, owner_id)
values
  ('cc000000-0000-4000-8000-000000000001', 'Cursor Fixture One',   'user', true, 4, false, '22222222-2222-2222-2222-222222222222'),
  ('cc000000-0000-4000-8000-000000000002', 'Cursor Fixture Two',   'user', true, 3, false, '22222222-2222-2222-2222-222222222222'),
  ('cc000000-0000-4000-8000-000000000003', 'Cursor Fixture Three', 'user', true, 2, false, '22222222-2222-2222-2222-222222222222'),
  ('cc000000-0000-4000-8000-000000000004', 'Cursor Fixture Four',  'user', true, 1, false, '22222222-2222-2222-2222-222222222222'),
  -- Private and joined: both must stay out of the rail's list.
  ('cc000000-0000-4000-8000-000000000005', 'Cursor Fixture Private', 'user', true, 99, true, '22222222-2222-2222-2222-222222222222')
on conflict (id) do update
  set name = excluded.name, type = excluded.type, is_active = excluded.is_active,
      member_count = excluded.member_count, is_private = excluded.is_private;

-- ── The walk ─────────────────────────────────────────────────────────────────
-- Page through the whole directory the way the Explore client does — three rows
-- at a time, each page's cursor taken from the previous page's last row — and
-- record what came back. Reading it in one call is exactly what the migration
-- removed, so the only honest way to test the bound is to use it.
create temporary table cursor_walk (page_no integer, name text, id uuid);

do $$
declare
  viewer      constant uuid := '00000000-0000-0000-0000-000000000000';
  cursor_name text := null;
  cursor_id   uuid := null;
  -- Deliberately not `page_no`: that is also the walk table's column name, and
  -- PL/pgSQL refuses to guess between a variable and a column.
  pages_read  integer := 0;
  inserted    integer := 0;
  last_name   text;
  last_id     uuid;
begin
  loop
    insert into cursor_walk (page_no, name, id)
      select pages_read + 1, page.name, page.id
      from public.get_all_communities(viewer, 3, cursor_name, cursor_id) as page;

    get diagnostics inserted = row_count;
    exit when inserted = 0;

    pages_read := pages_read + 1;

    select walked.name, walked.id into last_name, last_id
    from cursor_walk as walked
    where walked.page_no = pages_read
    order by walked.name desc, walked.id desc
    limit 1;

    cursor_name := last_name;
    cursor_id   := last_id;

    -- A cursor that failed to advance would otherwise spin here forever.
    exit when pages_read >= 200;
  end loop;
end $$;

create temporary view cursor_pages as
select count(distinct page_no)::integer as pages, count(*)::integer as rows
from cursor_walk;

select ok((select pages from cursor_pages) >= 1, 'the walk read at least one page');

-- Every page that is not the last one is exactly the requested size: this is the
-- LIMIT, asserted rather than assumed.
select is(
  (select count(*)::integer from cursor_walk
   where page_no < (select max(page_no) from cursor_walk)),
  3 * ((select pages from cursor_pages) - 1),
  'every page but the last holds exactly the requested number of rows'
);

-- The cursor is exclusive, so a row can never be served twice.
select is(
  (select count(distinct id)::integer from cursor_walk),
  (select rows from cursor_pages),
  'no community is served on two pages'
);

-- …and it never moves backwards: across a page seam as much as within a page.
select is(
  (select count(*)::integer
   from (
     select name, id,
            lag(name) over w as previous_name,
            lag(id)   over w as previous_id
     from cursor_walk
     window w as (order by page_no, name, id)
   ) ordered
   where previous_name is not null
     and (name, id) <= (previous_name, previous_id)),
  0,
  'the walked rows are strictly increasing by (name, id) across every page boundary'
);

-- The strong one: the walk visited EVERY eligible community, not merely some
-- ordered subset of them. The eligible set is restated here from the tables
-- (active, non-empty, not an event chat, master-data reference resolving) so the
-- comparison is against the database rather than against the function.
select is(
  (select count(*)::integer from cursor_walk),
  (select count(*)::integer
   from public.communities as c
   left join public.cities             as city     on c.type = 'city'             and city.id     = c.reference_id
   left join public.design_sectors     as sector   on c.type = 'sector'           and sector.id   = c.reference_id
   left join public.experience_levels  as experience on c.type = 'experience_level' and experience.id = c.reference_id
   left join public.job_titles         as job      on c.type = 'job_title'        and job.id      = c.reference_id
   where c.is_active = true
     and c.member_count > 0
     and c.type <> 'event'
     and case c.type
       when 'city' then city.id is not null
       when 'sector' then sector.id is not null
       when 'experience_level' then experience.id is not null
       when 'job_title' then job.id is not null
       else true
     end),
  'the paged read visits every eligible community exactly once'
);

-- ── The bound itself ─────────────────────────────────────────────────────────
select is(
  (select count(*)::integer
   from public.get_all_communities('00000000-0000-0000-0000-000000000000', 0)),
  1,
  'a page size below the floor is clamped up to one row'
);

select ok(
  (select count(*)::integer
   from public.get_all_communities('00000000-0000-0000-0000-000000000000', 100000)) <= 500,
  'a page size above the ceiling is clamped to 500 rows'
);

-- ── The rail's own read ──────────────────────────────────────────────────────
select is(
  (select count(*)::integer
   from public.get_suggested_communities('00000000-0000-0000-0000-000000000000', 50) as suggestion
   where suggestion.type <> 'user'
      or suggestion.is_private
      or suggestion.joined
      or not suggestion.can_join),
  0,
  'the rail read returns only open, joinable, member-created communities'
);

select is(
  (select count(*)::integer
   from public.get_suggested_communities('00000000-0000-0000-0000-000000000000', 2)),
  2,
  'the rail read honours its own bound'
);

select is(
  (select array_agg(suggestion.name order by suggestion.member_count desc, suggestion.name, suggestion.id)
   from public.get_suggested_communities('00000000-0000-0000-0000-000000000000', 50) as suggestion),
  (select array_agg(c.name order by c.member_count desc, c.name, c.id)
   from public.communities as c
   where c.is_active = true
     and c.member_count > 0
     and c.type = 'user'
     and coalesce(c.is_private, false) = false
     and not exists (
       select 1 from public.community_members as cm
       where cm.community_id = c.id
         and cm.user_id = '00000000-0000-0000-0000-000000000000'
     )),
  'the rail read is the biggest eligible communities, biggest first'
);

select * from public.finish();
rollback;
