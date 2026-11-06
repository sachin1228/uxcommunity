-- Stage 4 AUD-P5 — community member search scans every membership.
--
-- Search is `users.name ILIKE '%term%'`. Without a trigram index that is a
-- sequential scan of the community's membership joined to every profile, on
-- every keystroke. pg_trgm is already installed for company search; the same
-- GIN index makes leading-wildcard ILIKE indexable here.
--
-- The search term is also escaped now. A member typing `%` or `_` used to
-- widen the pattern into "match everything" (and could never find a literal
-- underscore), which both changed relevance and defeated the index.

create index idx_users_name_trgm on public.users using gin (name gin_trgm_ops);

create or replace function public.get_community_members_page(p_community_id uuid, p_search text default null::text, p_limit integer default 30, p_offset integer default 0)
returns table(user_id uuid, joined_at timestamp with time zone, role text, name text, total bigint)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_search  text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_total   bigint;
begin
  v_pattern := case when v_search is null then null else
    '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if v_pattern is null then
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
      and u.name ilike v_pattern escape '\';
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
    and (v_pattern is null or u.name ilike v_pattern escape '\')
  order by
    (case m.role when 'owner' then 0 when 'admin' then 1 else 2 end) asc,
    m.joined_at asc,
    m.user_id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

create or replace function public.get_admin_community_members_page(p_community_id uuid, p_search text default null::text, p_limit integer default 30, p_offset integer default 0)
returns table(user_id uuid, joined_at timestamp with time zone, role text, name text, email text, total bigint)
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_search  text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_total   bigint;
begin
  v_pattern := case when v_search is null then null else
    '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;

  if v_pattern is null then
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
      and u.name ilike v_pattern escape '\';
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
    and (v_pattern is null or u.name ilike v_pattern escape '\')
  order by
    m.joined_at asc,
    m.user_id asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;
