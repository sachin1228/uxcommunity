-- The community Media tab: one chronological feed of every picture and video
-- a community has posted outside chat — thread image attachments, showcase
-- images/videos (plus the legacy single-image column), and event covers.
-- Chat images are deliberately not a source: the Media tab sits beside the
-- chat, not inside it, and the chat's own photos stay in the chat timeline.
--
-- Keyset pagination is a composite tuple: (created_at desc, source asc,
-- source_id asc, ordinal asc), where ordinal is the attachment's 1-based
-- position inside its row (0 for the single-image columns). Sorting the tie
-- fields ascending lets the cursor predicate use one row comparison.

create or replace function public.get_community_media_page(
  p_community_id uuid,
  p_user_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_source text default null,
  p_cursor_source_id uuid default null,
  p_cursor_ordinal integer default null,
  p_limit integer default 60
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
  with media as (
    -- Thread image attachments ({name,url,type,size} items); pdf/zip/text
    -- attachments are not media.
    select t.id as source_id, 'thread'::text as source, t.title as source_title,
           t.created_at, t.user_id,
           attachment.value->>'url' as url,
           attachment.value->>'type' as media_type,
           null::text as poster,
           null::text as status,
           attachment.ordinality::integer as ordinal
    from public.community_threads t
    cross join lateral jsonb_array_elements(t.attachments)
      with ordinality as attachment(value, ordinality)
    where t.community_id = p_community_id
      and coalesce(attachment.value->>'type', '') like 'image/%'

    union all

    -- Showcase attachments: images and videos (videos carry a poster frame).
    select p.id, 'showcase', p.title, p.created_at, p.user_id,
           attachment.value->>'url',
           attachment.value->>'type',
           attachment.value->>'poster',
           attachment.value->>'status',
           attachment.ordinality::integer
    from public.community_showcase_posts p
    cross join lateral jsonb_array_elements(p.attachments)
      with ordinality as attachment(value, ordinality)
    where p.community_id = p_community_id
      and (coalesce(attachment.value->>'type', '') like 'image/%'
           or coalesce(attachment.value->>'type', '') like 'video/%')

    union all

    -- Legacy single-image showcase posts (before rich attachments); skipped
    -- when the same URL is already carried as an attachment.
    select p.id, 'showcase', p.title, p.created_at, p.user_id,
           p.image_url, 'image/*', null, null, 0
    from public.community_showcase_posts p
    where p.community_id = p_community_id
      and p.image_url is not null
      and not exists (
        select 1 from jsonb_array_elements(p.attachments) as attachment
        where attachment->>'url' = p.image_url
      )

    union all

    -- Event cover images.
    select e.id, 'event', e.title, e.created_at, e.user_id,
           e.cover_image_url, 'image/*', null, null, 0
    from public.community_events e
    where e.community_id = p_community_id
      and e.cover_image_url is not null
  ),
  page as (
    select m.*
    from media m
    where p_cursor_created_at is null
       or m.created_at < p_cursor_created_at
       or (m.created_at = p_cursor_created_at
           and (m.source, m.source_id, m.ordinal)
               > (p_cursor_source, p_cursor_source_id, p_cursor_ordinal))
    order by m.created_at desc, m.source asc, m.source_id asc, m.ordinal asc
    limit least(greatest(coalesce(p_limit, 60), 1), 120)
  )
  select jsonb_build_object(
    'source', page.source,
    'source_id', page.source_id,
    'source_title', page.source_title,
    'url', page.url,
    'media_type', page.media_type,
    'poster', page.poster,
    'status', page.status,
    'ordinal', page.ordinal,
    'created_at', page.created_at,
    'user_id', page.user_id,
    'author', case when author.id is null then null else jsonb_build_object(
      'name', author.name,
      'avatar_url', profile.avatar_url
    ) end
  )
  from page
  left join public.users as author on author.id = page.user_id
  left join public.designer_profiles as profile on profile.user_id = page.user_id
  order by page.created_at desc, page.source asc, page.source_id asc, page.ordinal asc;
end;
$$;

comment on function public.get_community_media_page(uuid, uuid, timestamptz, text, uuid, integer, integer) is
  'One page of a community''s media (thread images, showcase images/videos + legacy image_url, event covers), newest first, keyset-paginated on (created_at desc, source, source_id, ordinal); raises 42501 for a non-member. Chat message images are not a source.';

revoke all on function public.get_community_media_page(uuid, uuid, timestamptz, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_community_media_page(uuid, uuid, timestamptz, text, uuid, integer, integer) to service_role;
