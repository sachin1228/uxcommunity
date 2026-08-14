-- Keyset pagination for the community Threads and Resources lists.
--
-- The tab views previously fetched a single fixed-size page (50 threads /
-- 100 resources) with no way to load older rows, silently truncating large
-- communities. These RPCs now accept a (created_at, id) keyset cursor so the
-- client can page through the full list — mirroring the existing
-- get_showcase_list_page / get_event_list_page. The internal LIMIT caps are
-- raised so callers can pass limit + 1 to detect whether another page exists.

drop function if exists public.get_thread_list_page(uuid, uuid, integer);
drop function if exists public.get_resource_list_page(uuid, uuid, integer);

create or replace function public.get_thread_list_page(
  p_community_id uuid,
  p_user_id uuid,
  p_before timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns table (item jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id
  ) then
    raise insufficient_privilege using message = 'Not a member of this community.';
  end if;

  return query
  with page as (
    select t.*
    from public.community_threads t
    where t.community_id = p_community_id
      and (p_before is null or (t.created_at, t.id) < (p_before, p_cursor_id))
    order by t.created_at desc, t.id desc
    limit least(greatest(p_limit, 1), 100)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'vote_count', (select count(*) from public.thread_votes v where v.thread_id = p.id),
    'comment_count', (select count(*) from public.thread_comments c where c.thread_id = p.id),
    'user_voted', exists(select 1 from public.thread_votes v where v.thread_id = p.id and v.user_id = p_user_id),
    'user_saved', exists(select 1 from public.thread_saves s where s.thread_id = p.id and s.user_id = p_user_id)
  ) - 'is_public'
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$$;

create or replace function public.get_resource_list_page(
  p_community_id uuid,
  p_user_id uuid,
  p_before timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 100
)
returns table (item jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id
  ) then
    raise insufficient_privilege using message = 'Not a member of this community.';
  end if;

  return query
  with page as (
    select r.*
    from public.community_resources r
    where r.community_id = p_community_id
      and (p_before is null or (r.created_at, r.id) < (p_before, p_cursor_id))
    order by r.created_at desc, r.id desc
    limit least(greatest(p_limit, 1), 200)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'save_count', (select count(*) from public.resource_saves s where s.resource_id = p.id),
    'comment_count', (select count(*) from public.resource_comments c where c.resource_id = p.id),
    'bookmark_count', (select count(*) from public.resource_bookmarks b where b.resource_id = p.id),
    'user_saved', exists(select 1 from public.resource_saves s where s.resource_id = p.id and s.user_id = p_user_id),
    'user_bookmarked', exists(select 1 from public.resource_bookmarks b where b.resource_id = p.id and b.user_id = p_user_id)
  ) - 'is_public'
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$$;

revoke all on function public.get_thread_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_resource_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_thread_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.get_resource_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;
