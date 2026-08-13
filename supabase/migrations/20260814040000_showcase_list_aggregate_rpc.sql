-- Return one showcase page with author and interaction aggregates in a single query.
-- The API route authorizes community membership before invoking this service-role-only RPC.

create or replace function public.get_showcase_list_page(
  p_community_id uuid,
  p_user_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 26
)
returns table (
  id uuid,
  community_id uuid,
  user_id uuid,
  title text,
  description text,
  image_url text,
  project_url text,
  post_type text,
  category text,
  tags text[],
  created_at timestamptz,
  updated_at timestamptz,
  author jsonb,
  like_count integer,
  comment_count integer,
  user_liked boolean,
  user_saved boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select post.*
    from public.community_showcase_posts as post
    where post.community_id = p_community_id
      and (
        p_cursor_created_at is null
        or post.created_at < p_cursor_created_at
        or (post.created_at = p_cursor_created_at and post.id < p_cursor_id)
      )
    order by post.created_at desc, post.id desc
    limit greatest(0, least(coalesce(p_limit, 26), 100))
  ),
  likes as (
    select showcase_like.post_id,
      count(*)::integer as like_count,
      bool_or(showcase_like.user_id = p_user_id) as user_liked
    from public.showcase_likes as showcase_like
    where showcase_like.post_id in (select page.id from page)
    group by showcase_like.post_id
  ),
  saves as (
    select showcase_save.post_id,
      bool_or(showcase_save.user_id = p_user_id) as user_saved
    from public.showcase_saves as showcase_save
    where showcase_save.post_id in (select page.id from page)
    group by showcase_save.post_id
  ),
  comments as (
    select showcase_comment.post_id, count(*)::integer as comment_count
    from public.showcase_comments as showcase_comment
    where showcase_comment.post_id in (select page.id from page)
    group by showcase_comment.post_id
  )
  select
    page.id,
    page.community_id,
    page.user_id,
    page.title,
    page.description,
    page.image_url,
    page.project_url,
    page.post_type,
    page.category,
    page.tags,
    page.created_at,
    page.updated_at,
    jsonb_build_object(
      'name', coalesce(showcase_author.name, 'Community member'),
      'avatar_url', showcase_profile.avatar_url
    ) as author,
    coalesce(likes.like_count, 0) as like_count,
    coalesce(comments.comment_count, 0) as comment_count,
    coalesce(likes.user_liked, false) as user_liked,
    coalesce(saves.user_saved, false) as user_saved
  from page
  left join public.users as showcase_author on showcase_author.id = page.user_id
  left join public.designer_profiles as showcase_profile on showcase_profile.user_id = page.user_id
  left join likes on likes.post_id = page.id
  left join saves on saves.post_id = page.id
  left join comments on comments.post_id = page.id
  order by page.created_at desc, page.id desc;
$$;

comment on function public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer) is
  'Returns one authorized showcase page with author and interaction aggregates.';

revoke all on function public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;
