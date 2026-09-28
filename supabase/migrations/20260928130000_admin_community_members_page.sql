-- ============================================================
-- M-2 (admin path) — Admin community member picker: paginate in the database
--
-- WHY
-- GET /api/admin/communities/[id]/members (the "Add community admin" picker
-- and the admin community page's member search) transferred every membership
-- row of the community and sliced the requested page in Node:
--
--   select user_id, joined_at, role
--   from community_members
--   where community_id = ?            -- every member
--   order by joined_at;
--   ...                               -- then .slice(page * 30, …) in JS
--   -- and, when searching, a second query for up to 500 matching user names,
--   -- intersected with the membership rows in JavaScript.
--
-- The normal member endpoint was fixed the same way in
-- 20260928120000_community_members_page.sql; this is the admin path. It gets
-- its own function rather than reusing the member one because it differs in
-- three ways that matter:
--
--   * ORDERING — the picker lists members by joined_at ascending; it does NOT
--     group owners and admins first the way the member endpoint does. So the
--     member function's ordering, and the index that supports it, cannot serve
--     this page.
--   * SHAPE — the picker renders each member's email, so the page must carry
--     name *and* email.
--   * AUTHORIZATION — the caller is an admin session, not a community member,
--     so keeping the two functions apart keeps each route's authorization
--     boundary legible and avoids one route depending on the other's filter
--     semantics.
--
-- ORDERING (must match the old behaviour)
-- joined_at ascending, with user_id as a deterministic tie-break so a tied
-- joined_at can never make two consecutive pages overlap or skip a member. The
-- old route ordered by joined_at alone, so ties were broken arbitrarily by the
-- database and a Node slice could then repeat or drop a row across pages; the
-- tie-break makes paging exact without changing the visible order.
--
-- AUTHORIZATION
-- The function is service-role only (revoked from public/anon/authenticated)
-- and security invoker. The API route remains the authorization boundary and is
-- unchanged: it requires an admin session (`requireSession("admin")`) before it
-- calls this function, so a non-admin session cannot reach it.
--
-- Depends on the C-1 materialized counter communities.member_count
-- (20260927120000_community_member_count.sql), which a trigger keeps exact.
-- ============================================================


-- ─── Supporting index ───────────────────────────────────────
-- The page read is `where community_id = ? order by joined_at, user_id
-- limit ? offset ?`. idx_community_members_page matches the *member* endpoint's
-- order ((community_id, role-rank, joined_at, user_id)) and cannot supply this
-- page's order, because the role-rank expression sits between community_id and
-- joined_at. Without an index that matches this sort key Postgres would read
-- and sort the community's whole membership on every page request — the exact
-- cost this change removes. This index matches the ORDER BY verbatim, so a page
-- is a bounded slice of an index scan. It does not duplicate the primary key
-- (community_id, user_id), idx_community_members_user (user_id),
-- idx_community_members_user_archive (user_id, archived_at),
-- idx_community_members_role (community_id, role) or idx_community_members_page,
-- which all stay as they are.
create index if not exists idx_community_members_joined_at
  on public.community_members (community_id, joined_at, user_id);


-- ─── The page function ──────────────────────────────────────
-- `total` is returned alongside each row so the route can keep its response
-- shape. For an unfiltered page it is the maintained communities.member_count
-- counter (audit C-1) — exact and O(1), so counting the community is never
-- reintroduced. A name search is inherently a scan over the community's
-- matches, so only then is the filtered count computed.
create or replace function public.get_admin_community_members_page(
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
  email text,
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
    u.email,
    v_total
  from public.community_members as m
  join public.users as u on u.id = m.user_id
  where m.community_id = p_community_id
    and (v_search is null or u.name ilike '%' || v_search || '%')
  order by
    m.joined_at asc,
    m.user_id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.get_admin_community_members_page(uuid, text, integer, integer) is
  'Admin member-picker page: returns only the requested page of a community''s members (joined_at order, user_id tie-break) with name and email, plus the match total. Service-role only; the /api/admin/communities/[id]/members route enforces the admin session.';

revoke all on function public.get_admin_community_members_page(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_admin_community_members_page(uuid, text, integer, integer)
  to service_role;
