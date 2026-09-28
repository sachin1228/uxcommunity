-- ============================================================
-- M-2 — Community member list: paginate in the database
--
-- WHY
-- GET /api/communities/[id]/members used to transfer every membership row of
-- the community and slice the requested page in Node:
--
--   select user_id, joined_at, role
--   from community_members
--   where community_id = ?           -- every member
--   order by joined_at;
--   ...                                    -- then .slice(page * 30, …) in JS
--
-- Asking for 30 members of a 50,000-member community therefore transferred and
-- deserialized 50,000 rows to return 30. This function returns only the page.
--
-- ORDERING (must match the old behaviour)
-- The route fetched members ordered by joined_at ascending and then applied a
-- stable sort by role rank (owner, admin, member), so the effective order was
-- (role rank, joined_at) ascending. This function orders by exactly that, with
-- user_id as a deterministic tie-break so that a tied joined_at can never make
-- two pages overlap or skip a row.
--
-- AUTHORIZATION
-- The function is service-role only (revoked from public/anon/authenticated).
-- The API route is the authorization boundary and requires community
-- membership before invoking it, exactly as it did before this change — the
-- same shape as the route-authorized get_showcase_list_page aggregate RPC.
-- ============================================================


-- ─── Supporting index ───────────────────────────────────────
-- The page read is `where community_id = ? order by role-rank, joined_at,
-- user_id limit ? offset ?`. The (community_id, user_id) primary key locates
-- the rows but cannot supply that order, so without an index that matches the
-- sort key Postgres reads and sorts the community's whole membership on every
-- page request. This expression index matches the ORDER BY verbatim, so a page
-- costs a bounded slice of an index scan (the requested page) instead of work
-- proportional to the community. It does not duplicate the primary key, the
-- per-user index, or idx_community_members_role (community_id, role), which
-- stay as they are.
create index if not exists idx_community_members_page
  on public.community_members (
    community_id,
    (case role when 'owner' then 0 when 'admin' then 1 else 2 end),
    joined_at,
    user_id
  );


-- ─── The page function ──────────────────────────────────────
-- `total` is returned so the route can preserve its response shape. For an
-- unfiltered page it is the maintained communities.member_count counter
-- (audit C-1), which is exact and O(1) — a count query here would reintroduce
-- work proportional to the community. A name search is inherently a scan over
-- the community's members, so only then is the filtered count computed.
create or replace function public.get_community_members_page(
  p_community_id uuid,
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  joined_at timestamptz,
  role text,
  name text,
  total bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total  bigint;
begin
  if v_search is null then
    select coalesce(c.member_count, 0)::bigint
    into v_total
    from public.communities as c
    where c.id = p_community_id;
    v_total := coalesce(v_total, 0);
  else
    select count(*)::bigint
    into v_total
    from public.community_members as m
    join public.users as u on u.id = m.user_id
    where m.community_id = p_community_id
      and u.name ilike '%' || v_search || '%';
  end if;

  return query
  select
    m.user_id,
    m.joined_at,
    m.role,
    u.name,
    v_total
  from public.community_members as m
  join public.users as u on u.id = m.user_id
  where m.community_id = p_community_id
    and (v_search is null or u.name ilike '%' || v_search || '%')
  order by
    (case m.role when 'owner' then 0 when 'admin' then 1 else 2 end) asc,
    m.joined_at asc,
    m.user_id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.get_community_members_page(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_community_members_page(uuid, text, integer, integer)
  to service_role;
