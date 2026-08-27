-- Persist the time a community message was edited so clients can show the
-- edited state after a refresh, not only while the realtime session is open.
alter table public.community_messages
  add column if not exists edited_at timestamptz default null;

-- The message page RPC has a table return type, so it must be recreated when
-- the new field is added to its result.
drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
);

create or replace function public.get_community_message_page(
  p_community_id uuid,
  p_user_id uuid,
  p_history_start timestamptz,
  p_before timestamptz default null,
  p_after timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  content text,
  created_at timestamptz,
  user_id uuid,
  reply_to_id uuid,
  image_url text,
  deleted_at timestamptz,
  edited_at timestamptz,
  users jsonb,
  reactions jsonb,
  reply_to jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with message_page as materialized (
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.image_url, message.deleted_at, message.edited_at
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
        message.reply_to_id, message.image_url, message.deleted_at, message.edited_at
      from public.community_messages as message
      where p_after is null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and (p_before is null or message.created_at < p_before)
      order by message.created_at desc, message.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.image_url, message.deleted_at, message.edited_at,
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
    ) end as reply_to
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as profile on profile.user_id = message.user_id
  left join public.experience_levels as experience on experience.slug = profile.experience_level::text
  left join public.community_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
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
  where p_user_id is not null
  order by message.created_at desc, message.id desc;
$$;

revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer) to service_role;
