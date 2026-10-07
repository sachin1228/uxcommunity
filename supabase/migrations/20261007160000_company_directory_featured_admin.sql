-- ============================================================
-- Migration: curating the picker's first screen from the admin page
--
-- WHY
--   20261007150000_company_directory_design_first.sql opens the "Where do you
--   work?" picker on a curated design block, but the block was only reachable by
--   editing data/company-directory/mnc-companies.json and deploying a migration.
--   This gives the admin page the same control the JSON has: feature a company,
--   move it within the block, take it out.
--
-- WHAT IT ADDS
--     company_featured_renumber    — the block's positions are 1..N with no
--                                    ties, after every edit.
--     admin_featured_companies     — the block, in order.
--     admin_set_company_featured   — put a company in the block (at the end) or
--                                    take it out.
--     admin_move_company_featured  — move it one position earlier or later.
--
--   and it teaches the two existing operations about the block:
--   admin_update_company clears a company's position when it is deactivated
--   (a hidden company must not lead the picker) and admin_delete_company
--   renumbers the survivors.
--
-- THE INVARIANT, ENFORCED
--   `featured_rank is null or (is_active and featured_rank >= 1)`: the block can
--   only ever contain companies the picker is willing to show, and no two rows
--   share a position once the helpers below have run. Before this file a
--   deactivated company would have kept its rank and silently left a hole in the
--   first screen — visible only to a designer looking at the picker.
--
-- NOT A SECOND SOURCE OF TRUTH
--   The picker reads `companies.featured_rank` through `search_companies`, so an
--   admin's edit is on the first screen immediately. The curated JSON seed
--   remains the day-one list; from then on this is the editor.
--
-- ACCESS
--   Every function here is service-role only (`company_featured_renumber` is
--   granted to nobody: it is an implementation detail of the three admin
--   functions). The routes call them after `requireSession("admin")`.
-- ============================================================


-- ─── The invariant ──────────────────────────────────────────

-- Dropped before it is added, so re-applying cannot fail on the name. The
-- `is_active` arm is the new part: a featured company is one the picker will
-- show, and `search_companies` filters on `is_active`.
alter table public.companies
  drop constraint if exists companies_featured_rank_check,
  add constraint companies_featured_rank_check
    check (featured_rank is null or (is_active and featured_rank >= 1));


-- ─── Keeping the block 1..N ─────────────────────────────────

-- Positions are what the browse arm orders by, so a delete or a removal leaves a
-- gap that nothing else would close: this rewrites the block as 1..N in the
-- order it is currently in (rank, then name, then id — a total order, so two
-- rows with the same rank can never be renumbered arbitrarily).
--
-- Deliberately not granted to any API role: it is called from inside the admin
-- functions, which are SECURITY DEFINER.
create or replace function public.company_featured_renumber()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  with ordered as (
    select
      c.id,
      row_number() over (order by c.featured_rank asc, c.name asc, c.id asc) as position
    from public.companies as c
    where c.featured_rank is not null
  )
  update public.companies as c
     set featured_rank = o.position
    from ordered as o
   where c.id = o.id
     and c.featured_rank is distinct from o.position;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

comment on function public.company_featured_renumber() is
  'Rewrites companies.featured_rank as 1..N in its current order, so the picker''s first screen has no gaps and no ties. Internal: called by the admin functions, executable by nobody through the API.';

revoke all on function public.company_featured_renumber() from public, anon, authenticated;


-- ─── Reading the block ──────────────────────────────────────

create or replace function public.admin_featured_companies()
returns table (
  -- Quoted: `position` is a keyword in PostgreSQL's column-definition grammar
  -- (POSITION(x IN y)), and an unquoted one here is a syntax error at CREATE.
  "position"      integer,
  id              uuid,
  name            text,
  slug            text,
  logo_url        text,
  domain          text,
  domain_verified boolean,
  member_count    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.featured_rank as position,
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    dom.domain,
    coalesce(dom.verified, false) as domain_verified,
    (select count(*)::bigint from public.company_members as m
      where m.company_id = c.id and m.verified) as member_count
  from public.companies as c
  -- The same primary-domain rule as admin_list_companies and the picker's
  -- search: a proved domain first, then the oldest hint.
  left join lateral (
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as dom on true
  where c.featured_rank is not null
  order by c.featured_rank asc;
$$;

comment on function public.admin_featured_companies() is
  'The design-first block — the companies the picker''s empty query shows first — in the order it shows them. Service-role only.';

revoke all on function public.admin_featured_companies() from public, anon, authenticated;
grant execute on function public.admin_featured_companies() to service_role;


-- ─── Featuring and unfeaturing ──────────────────────────────

-- Idempotent in both directions: featuring a company that is already in the
-- block returns its position and changes nothing, and unfeaturing one that is
-- not in it is a no-op. The UI can therefore retry a request safely.
create or replace function public.admin_set_company_featured(
  p_id       uuid,
  p_featured boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_active boolean;
  v_rank      integer;
begin
  if p_featured is null then
    raise exception using errcode = '22023', message = 'featured_required';
  end if;

  select c.is_active, c.featured_rank
    into v_is_active, v_rank
  from public.companies as c
  where c.id = p_id;

  -- `is_active` is NOT NULL, so a null here means no row.
  if v_is_active is null then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  if p_featured then
    if not v_is_active then
      raise exception using errcode = 'P0001', message = 'company_inactive',
        hint = 'activate the company first: a hidden company cannot lead the picker';
    end if;

    if v_rank is null then
      select coalesce(max(c.featured_rank), 0) + 1
        into v_rank
      from public.companies as c
      where c.featured_rank is not null;

      update public.companies as c set featured_rank = v_rank where c.id = p_id;
    end if;

    return v_rank;
  end if;

  if v_rank is not null then
    update public.companies as c set featured_rank = null where c.id = p_id;
    perform public.company_featured_renumber();
  end if;

  return null;
end;
$$;

comment on function public.admin_set_company_featured(uuid, boolean) is
  'Adds a company to the design-first block at the end, or removes it and closes the gap. Returns the position, or null once it is out. Refuses an inactive company. Service-role only.';

revoke all on function public.admin_set_company_featured(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_company_featured(uuid, boolean) to service_role;


-- ─── Moving within the block ────────────────────────────────

-- p_direction is -1 for one position earlier, 1 for one position later. Moving
-- the first row earlier or the last row later is a no-op rather than an error:
-- the buttons are disabled at the ends, and a stale page should not turn a
-- harmless click into a failure.
create or replace function public.admin_move_company_featured(
  p_id        uuid,
  p_direction integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank       integer;
  v_neighbour  uuid;
  v_their_rank integer;
begin
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_direction';
  end if;

  select c.featured_rank into v_rank
  from public.companies as c
  where c.id = p_id;

  if v_rank is null then
    if not exists (select 1 from public.companies as c where c.id = p_id) then
      raise exception using errcode = 'P0002', message = 'company_not_found';
    end if;
    raise exception using errcode = 'P0001', message = 'company_not_featured';
  end if;

  -- The neighbour is a POSITION away, not a rank away: ranks are 1..N while
  -- company_featured_renumber() has run, but the block is defined by its order,
  -- and a swap of two ranks keeps that order whatever the gaps are.
  with ordered as (
    select
      c.id,
      c.featured_rank as rank,
      row_number() over (order by c.featured_rank asc, c.name asc, c.id asc) as position
    from public.companies as c
    where c.featured_rank is not null
  )
  select n.id, n.rank
    into v_neighbour, v_their_rank
  from ordered as m
  join ordered as n on n.position = m.position + p_direction
  where m.id = p_id;

  if v_neighbour is null then
    return v_rank;
  end if;

  -- `featured_rank` carries no unique index, so the intermediate duplicate is
  -- allowed and the two statements cannot deadlock against themselves.
  update public.companies as c set featured_rank = v_their_rank where c.id = p_id;
  update public.companies as c set featured_rank = v_rank where c.id = v_neighbour;

  return v_their_rank;
end;
$$;

comment on function public.admin_move_company_featured(uuid, integer) is
  'Moves a company one position within the design-first block (-1 earlier, 1 later) and returns its new position; a move off either end changes nothing. Service-role only.';

revoke all on function public.admin_move_company_featured(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_move_company_featured(uuid, integer) to service_role;


-- ─── The list now reports the position ──────────────────────

-- Dropped rather than replaced: the result gains `featured_rank`, and PostgreSQL
-- refuses to change a function's return type in place.
drop function if exists public.admin_list_companies(text, boolean, integer, integer);

create or replace function public.admin_list_companies(
  p_query  text default '',
  p_all    boolean default false,
  p_limit  integer default 200,
  p_offset integer default 0
)
returns table (
  id              uuid,
  name            text,
  slug            text,
  logo_url        text,
  is_active       boolean,
  created_at      timestamptz,
  domain          text,
  domain_verified boolean,
  domain_count    integer,
  member_count    bigint,
  total_count     bigint,
  featured_rank   integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select
      c.id,
      c.name,
      c.slug,
      c.logo_url,
      c.is_active,
      c.created_at,
      c.featured_rank,
      (select count(*)::integer from public.company_domains as d
        where d.company_id = c.id) as domain_count,
      (select count(*)::bigint from public.company_members as m
        where m.company_id = c.id and m.verified) as member_count
    from public.companies as c
    where (p_all or c.is_active)
      and (
        btrim(coalesce(p_query, '')) = ''
        or c.name ilike '%' || public.company_search_term(p_query) || '%' escape '\'
        or c.slug ilike '%' || lower(public.company_search_term(p_query)) || '%' escape '\'
      )
  )
  select
    f.id,
    f.name,
    f.slug,
    f.logo_url,
    f.is_active,
    f.created_at,
    dom.domain,
    coalesce(dom.verified, false) as domain_verified,
    f.domain_count,
    f.member_count,
    count(*) over() as total_count,
    f.featured_rank
  from filtered as f
  -- The primary domain: a proved one first, then the oldest hint. This is the
  -- same order the picker's search uses, so a row reads the same in both places.
  left join lateral (
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = f.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as dom on true
  order by f.name asc
  -- 1,000 rather than 500: the page filters client-side, and the curated
  -- directory alone is 573 rows, so a directory row past the cap was invisible
  -- in the admin page — including to whoever wanted to feature it.
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.admin_list_companies(text, boolean, integer, integer) is
  'Admin company directory page: each company with its primary domain, proof flag, domain count, verified member count and its design-first position (null when it is not in the block), plus the match total. Search is by name or slug. Service-role only.';

revoke all on function public.admin_list_companies(text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_companies(text, boolean, integer, integer) to service_role;


-- ─── Deactivating a company takes it out of the block ───────

create or replace function public.admin_update_company(
  p_id       uuid,
  p_name     text default null,
  p_is_active boolean default null,
  p_logo_url text default null
)
returns table (
  id        uuid,
  name      text,
  slug      text,
  logo_url  text,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := nullif(btrim(coalesce(p_name, '')), '');
  v_existing uuid;
begin
  if not exists (select 1 from public.companies as c where c.id = p_id) then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  if p_name is not null then
    if v_name is null or char_length(v_name) > 120 then
      raise exception using errcode = '22023', message = 'company_name_required';
    end if;

    select c.id into v_existing
    from public.companies as c
    where lower(btrim(c.name)) = lower(v_name) and c.id <> p_id
    limit 1;

    if v_existing is not null then
      raise exception using errcode = 'P0001', message = 'company_name_taken';
    end if;
  end if;

  update public.companies as c
  set name      = coalesce(v_name, c.name),
      is_active = coalesce(p_is_active, c.is_active),
      logo_url  = coalesce(nullif(btrim(coalesce(p_logo_url, '')), ''), c.logo_url),
      -- A hidden company cannot lead the picker, and the check constraint says
      -- so: the position is cleared in the same statement as the deactivation,
      -- and the block closes the gap below.
      featured_rank = case
        when coalesce(p_is_active, c.is_active) then c.featured_rank
        else null
      end
  where c.id = p_id;

  perform public.company_featured_renumber();

  return query
  select c.id, c.name, c.slug, c.logo_url, c.is_active
  from public.companies as c
  where c.id = p_id;
end;
$$;

comment on function public.admin_update_company(uuid, text, boolean, text) is
  'Renames or activates/deactivates a company (a null argument leaves the field alone). A name another company already holds is refused. Deactivating also takes the company out of the design-first block. Service-role only.';

revoke all on function public.admin_update_company(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_update_company(uuid, text, boolean, text) to service_role;


-- ─── Deleting one closes the gap it leaves ──────────────────

create or replace function public.admin_delete_company(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found uuid;
begin
  select c.id into v_found from public.companies as c where c.id = p_id;
  if v_found is null then
    return false;
  end if;

  delete from public.companies as c where c.id = p_id;

  -- The delete cascades the domains, memberships and challenges, and would
  -- leave the position it held empty; renumber the block that is left.
  perform public.company_featured_renumber();

  return true;
end;
$$;

comment on function public.admin_delete_company(uuid) is
  'Removes a company and, by cascade, its domains, memberships and pending challenges, then closes the gap it leaves in the design-first block. Returns false when the row did not exist. Service-role only.';

revoke all on function public.admin_delete_company(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_company(uuid) to service_role;
