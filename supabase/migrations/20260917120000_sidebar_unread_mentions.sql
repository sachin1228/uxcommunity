-- Sidebar unread @mentions
--
-- The chat's floating "@" pill tells a member they were mentioned while they
-- had the community open. The sidebar needs the same signal for communities
-- they are NOT looking at, so the community row can raise a blue "@" next to
-- its unread badge.
--
-- Mentions already live on the message row (community_messages.mentions, an
-- array of { user_id, name } snapshots written by the messages POST route), so
-- this is a filter on the unread count the RPC already computes — no new table,
-- no notification rows. A row that predates the mentions column (or a message
-- with no mentions) reads as '[]' and is skipped.
--
-- Row shape is otherwise unchanged; unread_mention_count is appended so older
-- clients ignore it.

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
  ), member_counts as (
    select cm.community_id, count(*)::integer as member_count
    from public.community_members cm
    join memberships m on m.community_id = cm.community_id
    group by cm.community_id
  ), message_stats as (
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
  ), latest_messages as (
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
  ), latest_reactions as (
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'community_id', membership.community_id,
    'joined_at', membership.joined_at,
    'last_read_at', membership.last_read_at,
    'archived_at', membership.archived_at,
    'member_count', coalesce(counts.member_count, 0),
    'unread_count', coalesce(stats.unread_count, 0),
    'unread_mention_count', coalesce(stats.unread_mention_count, 0),
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
      ) end
  )), '[]'::jsonb)
  from memberships membership
  left join member_counts counts using (community_id)
  left join message_stats stats using (community_id)
  left join latest_messages latest using (community_id)
  left join latest_reactions reaction using (community_id);
$$;

comment on function public.get_sidebar_activity(uuid) is
  'Sidebar community rows for one member: member/unread counts (including unread @mentions) and the latest message or reaction preview.';

revoke all on function public.get_sidebar_activity(uuid) from public, anon, authenticated;
grant execute on function public.get_sidebar_activity(uuid) to service_role;
