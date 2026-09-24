-- Extend the chat message page RPC for content-notification reactions/replies:
--   * reply_to_content_id rides along so bubbles can anchor replies to a
--     "created a …" card instead of a message.
--   * reply_to_content is resolved to { id, kind, title } via the four content
--     tables (ids are uuids, so at most one table can match).
--   * content_reactions are returned for the content items referenced by the
--     page's reply rows AND by a passed-in list of content ids (the timeline's
--     notification cards), grouped as [{ content_id, kind, reactions }].
--   * p_content_ids is appended to the signature — callers that don't pass it
--     keep working unchanged.
-- Based on the live definition (union-all page branch + experience-level
-- designation); apply after 20260923200000_content_notification_reactions_replies.sql.

create or replace function public.get_community_message_page(
  p_community_id uuid,
  p_user_id uuid,
  p_history_start timestamptz,
  p_before timestamptz default null,
  p_after timestamptz default null,
  p_limit integer default 50,
  p_content_ids uuid[] default null
)
returns table (
  id uuid,
  content text,
  created_at timestamptz,
  user_id uuid,
  reply_to_id uuid,
  reply_to_content_id uuid,
  image_url text,
  deleted_at timestamptz,
  edited_at timestamptz,
  mentions jsonb,
  users jsonb,
  reactions jsonb,
  reply_to jsonb,
  reply_to_content jsonb,
  content_reactions jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with message_page as materialized (
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.reply_to_content_id, message.image_url,
        message.deleted_at, message.edited_at, message.mentions
      from public.community_messages as message
      where p_after is not null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and message.created_at > p_after
      order by message.created_at asc, message.id asc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    union all
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.reply_to_content_id, message.image_url,
        message.deleted_at, message.edited_at, message.mentions
      from public.community_messages as message
      where p_after is null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and (p_before is null or message.created_at < p_before)
      order by message.created_at desc, message.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  ),
  -- Every content item whose reactions the timeline needs on this page: the
  -- explicit notification-card ids plus any content items replied to here.
  interesting_content as (
    select distinct unnest(
      coalesce(
        p_content_ids || array_agg(message_page.reply_to_content_id) filter (where message_page.reply_to_content_id is not null),
        p_content_ids
      )
    ) as content_id
    from message_page
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.reply_to_content_id, message.image_url,
    message.deleted_at, message.edited_at,
    coalesce(message.mentions, '[]'::jsonb) as mentions,
    case when author.id is null then null else jsonb_build_object(
      'name', author.name,
      'avatar_url', profile.avatar_url,
      'designation', case
        when experience.name is null then null
        when experience.name ~* '^heads\s+of\b' then regexp_replace(experience.name, '^heads', 'Head', 'i')
        else regexp_replace(split_part(experience.name, '(', 1), 's\s*$', '')
      end
    ) end as users,
    coalesce(reaction_groups.reactions, '[]'::jsonb) as reactions,
    case when reply.id is null then null else jsonb_build_object(
      'id', reply.id,
      'content', coalesce(reply.content, ''),
      'user_name', coalesce(reply_author.name, 'Unknown')
    ) end as reply_to,
    case when message.reply_to_content_id is null then null else jsonb_build_object(
      'id', message.reply_to_content_id,
      'kind', case
        when rc_thread.id is not null then 'thread'
        when rc_showcase.id is not null then 'showcase'
        when rc_resource.id is not null then 'resource'
        else 'event'
      end,
      'title', coalesce(rc_thread.title, rc_showcase.title, rc_resource.title, rc_event.title, '')
    ) end as reply_to_content,
    coalesce(content_reaction_groups.groups, '[]'::jsonb) as content_reactions
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as profile on profile.user_id = message.user_id
  left join public.experience_levels as experience on experience.slug = profile.experience_level::text
  left join public.community_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
  -- Content-anchored replies: resolve the anchor's kind + title.
  left join public.community_threads as rc_thread on rc_thread.id = message.reply_to_content_id
  left join public.community_showcase_posts as rc_showcase on rc_showcase.id = message.reply_to_content_id
  left join public.community_resources as rc_resource on rc_resource.id = message.reply_to_content_id
  left join public.community_events as rc_event on rc_event.id = message.reply_to_content_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('emoji', grouped.emoji, 'user_ids', grouped.user_ids)
      order by grouped.emoji
    ) as reactions
    from (
      select reaction.emoji, jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
      from public.message_reactions as reaction
      where reaction.message_id = message.id
      group by reaction.emoji
    ) as grouped
  ) as reaction_groups on true
  -- Grouped reaction state per content item. Two levels of aggregation and NO
  -- join back to content_reactions between them: joining the per-emoji groups
  -- against the raw rows multiplies each emoji once per reacting user, which
  -- rendered duplicate pills (and duplicate React keys).
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'content_id', per_content.content_id,
        'kind', per_content.content_kind,
        'reactions', per_content.reactions
      )
      order by per_content.content_id
    ) as groups
    from (
      select
        emoji_groups.content_id,
        min(emoji_groups.content_kind) as content_kind,
        jsonb_agg(
          jsonb_build_object('emoji', emoji_groups.emoji, 'user_ids', emoji_groups.user_ids)
          order by emoji_groups.emoji
        ) as reactions
      from (
        select
          reaction.content_id,
          reaction.content_kind,
          reaction.emoji,
          jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
        from public.content_reactions as reaction
        join interesting_content as ic on ic.content_id = reaction.content_id
        group by reaction.content_id, reaction.content_kind, reaction.emoji
      ) as emoji_groups
      group by emoji_groups.content_id
    ) as per_content
  ) as content_reaction_groups on true
  where p_user_id is not null
  order by message.created_at desc, message.id desc;
$$;

revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[]) from public;
revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[]) from anon;
revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[]) from authenticated;
grant execute on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[]) to service_role;
