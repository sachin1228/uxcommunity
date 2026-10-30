-- ============================================================
-- Restore the 7-column resource aggregate RPC
--
-- 20260814030000 originally created this function without allow_replies; a
-- later UI change edited that ALREADY-APPLIED migration in place to add the
-- column. That edit never reaches a database that applied the old file, and on
-- a FRESH database it references community_resources.allow_replies before
-- 20260911160000 adds the column, so the function is never created at all.
--
-- 20260814030000 is restored to its safe 6-column form for fresh installs.
-- This forward migration is the single source of truth for the 7-column
-- definition and is safe to apply to production (where the 6-column version
-- currently exists) and to a fresh database.
-- ============================================================

begin;

alter table public.community_resources
  add column if not exists allow_replies boolean not null default true;

-- A return-type change requires a drop; CREATE OR REPLACE cannot add columns.
drop function if exists public.get_resource_list_aggregates(uuid, uuid[]);

create function public.get_resource_list_aggregates(
  p_user_id uuid,
  p_resource_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  save_count bigint,
  comment_count bigint,
  bookmark_count bigint,
  user_saved boolean,
  user_bookmarked boolean,
  allow_replies boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_resource_ids, '{}'::uuid[])) as input(requested_id)
  ),
  saves as (
    select s.resource_id as id,
      count(*) as save_count,
      bool_or(s.user_id = p_user_id) as user_saved
    from public.resource_saves as s
    where s.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by s.resource_id
  ),
  comments as (
    select c.resource_id as id, count(*) as comment_count
    from public.resource_comments as c
    where c.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by c.resource_id
  ),
  bookmarks as (
    select b.resource_id as id,
      count(*) as bookmark_count,
      bool_or(b.user_id = p_user_id) as user_bookmarked
    from public.resource_bookmarks as b
    where b.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by b.resource_id
  ),
  resources as (
    select r.id,
      bool_or(r.allow_replies = true) as allow_replies
    from public.community_resources r
    where r.id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by r.id
  )
  select requested.id,
    coalesce(saves.save_count, 0),
    coalesce(comments.comment_count, 0),
    coalesce(bookmarks.bookmark_count, 0),
    coalesce(saves.user_saved, false),
    coalesce(bookmarks.user_bookmarked, false),
    coalesce(resources.allow_replies, false)
  from requested
  left join saves using (id)
  left join comments using (id)
  left join bookmarks using (id)
  left join resources using (id);
$$;

comment on function public.get_resource_list_aggregates(uuid, uuid[]) is
  'Returns interaction aggregates and the allow_replies flag for one authorized resource list page.';

revoke all on function public.get_resource_list_aggregates(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_resource_list_aggregates(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';

commit;
