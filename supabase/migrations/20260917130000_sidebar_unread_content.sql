-- Sidebar unread content (threads, showcase posts, resources, events)
--
-- The chat timeline already shows a "John created a new thread" notification
-- card for every thread created in the community. The sidebar needs the same
-- signal for communities the member is NOT looking at — otherwise a community
-- whose only new activity is a thread/showcase/resource/event shows no unread
-- badge and no preview at all.
--
-- This migration extends get_sidebar_activity with two fields per community:
--   unread_content_count — content items created by others after last_read_at
--                          (only kinds the community has enabled count: a
--                          thread in a community with threads switched off
--                          must not raise a badge nobody can clear)
--   latest_content       — the newest content item regardless of read state,
--                          so the preview line mirrors what the chat timeline
--                          shows ("john created a thread")
--
-- Shape is additive only: older clients ignore the new keys. unread_count and
-- unread_mention_count keep meaning *messages* exactly as before — the badge
-- simply grows to include content activity.

create or replace function public.get_sidebar_activity(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with memberships as (
    select community_id, joined_at, last_read_at, archived_at
    from public.community_members
    where user_id = p_user_id
  ),
  member_counts as (
    select cm.community_id, count(*)::integer as member_count
    from public.community_members cm
    join memberships m on m.community_id = cm.community_id
    group by cm.community_id
  ),
  message_stats as (
    select m.community_id,
      count(*) filter (
        where m.user_id <> p_user_id
          and (membership.last_read_at is null or m.created_at > membership.last_read_at)
      )::integer as unread_count,
      count(*) filter (
        where m.user_id <> p_user_id
          and (membership.last_read_at is null or m.created_at > membership.last_read_at)
          and exists (
            select 1
            from jsonb_array_elements(coalesce(m.mentions, '[]'::jsonb)) as mentioned
            where mentioned ->> 'user_id' = p_user_id::text
          )
      )::integer as unread_mention_count
    from public.community_messages m
    join memberships membership on membership.community_id = m.community_id
    where m.created_at > membership.joined_at
    group by m.community_id
  ),
  latest_messages as (
    select distinct on (m.community_id)
      m.community_id, m.id, m.content, m.created_at, m.user_id,
      m.reply_to_id, m.deleted_at, m.image_url,
      sender.name as sender_name, parent_sender.name as reply_sender_name
    from public.community_messages m
    join memberships membership on membership.community_id = m.community_id
    left join public.users sender on sender.id = m.user_id
    left join public.community_messages parent on parent.id = m.reply_to_id
    left join public.users parent_sender on parent_sender.id = parent.user_id
    where m.created_at > membership.joined_at
    order by m.community_id, m.created_at desc, m.id desc
  ),
  latest_reactions as (
    select distinct on (r.community_id)
      r.community_id, r.message_id, r.user_id, r.emoji, r.created_at,
      reactor.name as reactor_name, message.content as message_content,
      message.image_url as message_image_url
    from public.message_reactions r
    join memberships membership on membership.community_id = r.community_id
    join public.community_messages message on message.id = r.message_id
    left join public.users reactor on reactor.id = r.user_id
    where r.created_at > membership.joined_at
    order by r.community_id, r.created_at desc, r.message_id desc
  ),
  -- Enabled areas per community. Threads/events/resources live in
  -- communities.enabled_tabs; showcase keeps its own flag which reads as ON
  -- for rows that predate it. A community without the areas enabled must not
  -- surface unread content for kinds its members cannot even see.
  area_flags as (
    select c.id as community_id,
      (c.enabled_tabs is null or 'threads' = any (c.enabled_tabs)) as threads_enabled,
      (c.enabled_tabs is null or 'events' = any (c.enabled_tabs)) as events_enabled,
      (c.enabled_tabs is null or 'resources' = any (c.enabled_tabs)) as resources_enabled,
      coalesce(c.showcase_enabled, true) as showcase_enabled
    from public.communities c
  ),
  content_items as (
    select t.community_id, t.id, t.user_id, t.created_at, 'thread'::text as kind, t.title
    from public.community_threads t
    join memberships membership on membership.community_id = t.community_id
    join area_flags flags on flags.community_id = t.community_id
    where flags.threads_enabled and t.created_at > membership.joined_at
    union all
    select s.community_id, s.id, s.user_id, s.created_at, 'showcase'::text as kind, s.title
    from public.community_showcase_posts s
    join memberships membership on membership.community_id = s.community_id
    join area_flags flags on flags.community_id = s.community_id
    where flags.showcase_enabled and s.created_at > membership.joined_at
    union all
    select r.community_id, r.id, r.user_id, r.created_at, 'resource'::text as kind, r.title
    from public.community_resources r
    join memberships membership on membership.community_id = r.community_id
    join area_flags flags on flags.community_id = r.community_id
    where flags.resources_enabled and r.created_at > membership.joined_at
    union all
    select e.community_id, e.id, e.user_id, e.created_at, 'event'::text as kind, e.title
    from public.community_events e
    join memberships membership on membership.community_id = e.community_id
    join area_flags flags on flags.community_id = e.community_id
    where flags.events_enabled and e.created_at > membership.joined_at
  ),
  content_stats as (
    select item.community_id,
      count(*) filter (
        where item.user_id <> p_user_id
          and (membership.last_read_at is null or item.created_at > membership.last_read_at)
      )::integer as unread_content_count
    from content_items item
    join memberships membership on membership.community_id = item.community_id
    group by item.community_id
  ),
  latest_content as (
    select distinct on (community_id)
      community_id, id, user_id, created_at, kind, title
    from content_items
    order by community_id, created_at desc, id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'community_id', membership.community_id,
    'joined_at', membership.joined_at,
    'last_read_at', membership.last_read_at,
    'archived_at', membership.archived_at,
    'member_count', coalesce(counts.member_count, 0),
    'unread_count', coalesce(stats.unread_count, 0),
    'unread_mention_count', coalesce(stats.unread_mention_count, 0),
    'unread_content_count', coalesce(content.unread_content_count, 0),
    'last_message', case when latest.id is null then null else jsonb_build_object(
      'id', latest.id, 'content', latest.content, 'created_at', latest.created_at,
      'user_id', latest.user_id, 'sender_name', latest.sender_name,
      'reply_to_id', latest.reply_to_id, 'reply_sender_name', latest.reply_sender_name,
      'deleted_at', latest.deleted_at, 'has_image', latest.image_url is not null
    ) end,
    'last_reaction', case
      when reaction.message_id is null or (latest.created_at is not null and reaction.created_at <= latest.created_at) then null
      else jsonb_build_object(
        'message_id', reaction.message_id, 'user_id', reaction.user_id,
        'emoji', reaction.emoji, 'created_at', reaction.created_at,
        'reactor_name', reaction.reactor_name, 'message_content', reaction.message_content,
        'has_image', reaction.message_image_url is not null
      ) end,
    'last_content', case when content_item.id is null then null else jsonb_build_object(
      'id', content_item.id, 'kind', content_item.kind, 'title', content_item.title,
      'created_at', content_item.created_at, 'user_id', content_item.user_id
    ) end
  )), '[]'::jsonb)
  from memberships membership
  left join member_counts counts using (community_id)
  left join message_stats stats using (community_id)
  left join content_stats content using (community_id)
  left join latest_messages latest using (community_id)
  left join latest_reactions reaction using (community_id)
  left join latest_content content_item using (community_id);
$$;

comment on function public.get_sidebar_activity(uuid) is
  'Sidebar community rows for one member: member/unread counts (messages, unread @mentions, unread content) and the latest message, reaction or content preview.';

revoke all on function public.get_sidebar_activity(uuid) from public, anon, authenticated;
grant execute on function public.get_sidebar_activity(uuid) to service_role;
