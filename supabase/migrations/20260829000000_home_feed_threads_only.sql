-- The homepage composer creates one kind of content: a public thread.
-- Community resources, events, showcases, and community-created public posts
-- stay in their respective community spaces instead of being copied into the
-- homepage feed.
create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select
      t.id,
      t.community_id,
      t.user_id,
      t.created_at,
      to_jsonb(t) as payload
    from public.community_threads t
    where t.is_public = true
      and t.community_id is null
      and (p_before is null or t.created_at < p_before)
    order by t.created_at desc, t.id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select
    (p.payload - 'is_public') || jsonb_build_object(
      '_type', 'thread',
      'users', case
        when u.id is null then null
        else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url)
      end,
      'community_name', null,
      'community_image', null,
      'comment_count', (select count(*) from public.thread_comments c where c.thread_id = p.id),
      'like_count', (select count(*) from public.thread_likes l where l.thread_id = p.id),
      'user_liked', exists(
        select 1 from public.thread_likes l
        where l.thread_id = p.id and l.user_id = p_user_id
      ),
      'save_count', (select count(*) from public.thread_saves s where s.thread_id = p.id),
      'user_saved', exists(
        select 1 from public.thread_saves s
        where s.thread_id = p.id and s.user_id = p_user_id
      )
    )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.get_home_feed_page(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer) to service_role;

create index if not exists idx_community_threads_public_home_created
  on public.community_threads (created_at desc, id desc)
  where is_public = true and community_id is null;
