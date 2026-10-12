-- ============================================================
-- DM conversation list: reaction preview
--
-- The community sidebar confirms a reaction in the row it happened in
-- ("john reacted ❤️ to: \"ok\""), and the DM list should read the same. This
-- adds `last_reaction` to get_dm_conversations: the conversation's newest
-- reaction event together with the reactor's name and the reacted message's
-- body (or image flag), SUPPRESSED once a newer message has arrived — the same
-- rule get_sidebar_activity applies, so a later message always takes the
-- preview line back.
--
-- Adding an OUT column changes the function's return type, so the old
-- signature is dropped before the replacement is created.
-- ============================================================

-- Backs the DISTINCT ON scan below (newest reaction per conversation).
create index if not exists idx_dm_message_reactions_conversation_time
  on public.dm_message_reactions (conversation_id, created_at desc);

drop function if exists public.get_dm_conversations(uuid);

create or replace function public.get_dm_conversations(
  p_user_id uuid
)
returns table (
  conversation_id uuid,
  peer jsonb,
  last_message jsonb,
  unread_count integer,
  my_last_read_at timestamptz,
  last_message_at timestamptz,
  last_reaction jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select c.id,
           c.last_message_at,
           case when c.user_a = p_user_id then c.user_b else c.user_a end as peer_id,
           case when c.user_a = p_user_id then c.user_a_last_read_at
                else c.user_b_last_read_at end as my_last_read_at
      from public.dm_conversations c
     where (c.user_a = p_user_id or c.user_b = p_user_id)
       and c.last_message_at is not null
     order by c.last_message_at desc
     limit 200
  ),
  -- Newest reaction per conversation, with its reactor and the reacted
  -- message's body — the sidebar row shows all three ("John reacted ❤️ to:
  -- \"ok\""). Only the viewer's own conversations are considered, so the
  -- projection never reaches outside the list it feeds.
  latest_reactions as (
    select distinct on (reaction.conversation_id)
      reaction.conversation_id,
      reaction.message_id,
      reaction.user_id,
      reaction.emoji,
      reaction.created_at,
      reactor.name as reactor_name,
      message.content as message_content,
      message.image_url as message_image_url
      from public.dm_message_reactions reaction
      join public.dm_messages message on message.id = reaction.message_id
      left join public.users reactor on reactor.id = reaction.user_id
     where reaction.conversation_id in (select mine.id from mine)
     order by reaction.conversation_id, reaction.created_at desc, reaction.message_id desc
  )
  select
    mine.id,
    case when peer.id is null then null else jsonb_build_object(
      'id', peer.id,
      'name', peer.name,
      'avatar_url', peer_profile.avatar_url
    ) end as peer,
    case when last_msg.id is null then null else jsonb_build_object(
      'id', last_msg.id,
      'content', last_msg.content,
      'image_url', last_msg.image_url,
      'created_at', last_msg.created_at,
      'user_id', last_msg.user_id,
      'deleted_at', last_msg.deleted_at,
      'edited_at', last_msg.edited_at
    ) end as last_message,
    coalesce(unread.cnt, 0)::integer as unread_count,
    mine.my_last_read_at,
    mine.last_message_at,
    case
      when reaction.message_id is null then null
      -- A message newer than the reaction takes the preview line back.
      when last_msg.created_at is not null and reaction.created_at <= last_msg.created_at then null
      else jsonb_build_object(
        'message_id', reaction.message_id,
        'user_id', reaction.user_id,
        'emoji', reaction.emoji,
        'created_at', reaction.created_at,
        'reactor_name', reaction.reactor_name,
        'message_content', reaction.message_content,
        'has_image', reaction.message_image_url is not null
      )
    end as last_reaction
  from mine
  left join lateral (
    select m.id, m.content, m.image_url, m.created_at, m.user_id,
           m.deleted_at, m.edited_at
      from public.dm_messages m
     where m.conversation_id = mine.id
     order by m.created_at desc, m.id desc
     limit 1
  ) as last_msg on true
  left join lateral (
    select count(*) as cnt
      from public.dm_messages m
     where m.conversation_id = mine.id
       and m.user_id <> p_user_id
       and m.created_at > coalesce(mine.my_last_read_at, '-infinity'::timestamptz)
  ) as unread on true
  left join latest_reactions reaction on reaction.conversation_id = mine.id
  left join public.users as peer on peer.id = mine.peer_id
  left join public.designer_profiles as peer_profile on peer_profile.user_id = mine.peer_id
  order by mine.last_message_at desc;
$$;

comment on function public.get_dm_conversations(uuid) is
  'DM conversation list: peer identity, last-message preview, viewer unread count and the newest reaction event per conversation (suppressed once a newer message exists).';

revoke all on function public.get_dm_conversations(uuid) from public, anon, authenticated;
grant execute on function public.get_dm_conversations(uuid) to service_role;
