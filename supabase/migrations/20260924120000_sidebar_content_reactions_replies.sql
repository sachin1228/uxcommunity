-- ============================================================
-- Sidebar previews for the chat timeline's permanent
-- "created a …" cards (thread / showcase / resource / event).
--
-- Two gaps closed here, both on get_sidebar_activity so the
-- sidebar keeps rendering from the single payload it fetches:
--
--   1. Reactions. A reaction left on a card lives in
--      content_reactions, which latest_reactions never read —
--      so reacting to a thread/resource/event card showed
--      nothing in the sidebar. latest_reactions now unions
--      both tables and the newest reaction across either wins,
--      previewing the card's title exactly like a message
--      preview does ("You reacted ❤️ to: "ui vs ux"").
--
--   2. Replies. A message that anchors to a card carries
--      reply_to_content_id (reply_to_id stays null), so the
--      sidebar could not tell it apart from a plain message.
--      last_message now ships reply_to_content_kind along with
--      the anchor id so the preview reads "replied to a
--      thread: …".
--
-- Re-runnable: create or replace only, no data changes.
-- ============================================================

create or replace function public.get_sidebar_activity(p_user_id uuid)
returns jsonb
language sql
stable
set search_path to ''
as $function$
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
      m.reply_to_id, m.reply_to_content_id, m.deleted_at, m.image_url,
      sender.name as sender_name, parent_sender.name as reply_sender_name
    from public.community_messages m
    join memberships membership on membership.community_id = m.community_id
    left join public.users sender on sender.id = m.user_id
    left join public.community_messages parent on parent.id = m.reply_to_id
    left join public.users parent_sender on parent_sender.id = parent.user_id
    where m.created_at > membership.joined_at
    order by m.community_id, m.created_at desc, m.id desc
  ),
  -- Titles of every content item, regardless of when the viewer joined: a
  -- reaction preview has to name the card it was left on, and a reply may
  -- anchor to a card created before the membership.
  content_titles as (
    select 'thread'::text as kind, t.id, t.title
    from public.community_threads t
    union all
    select 'showcase'::text, s.id, s.title
    from public.community_showcase_posts s
    union all
    select 'resource'::text, r.id, r.title
    from public.community_resources r
    union all
    select 'event'::text, e.id, e.title
    from public.community_events e
  ),
  -- Newest reaction in the community across BOTH anchors: a chat message or a
  -- content card. content_kind is null for message reactions, so the sidebar
  -- can render a card reaction with the card's own vocabulary.
  latest_reactions as (
    select distinct on (unioned.community_id)
      unioned.community_id, unioned.message_id, unioned.user_id, unioned.emoji,
      unioned.created_at, unioned.reactor_name, unioned.message_content,
      unioned.message_image_url, unioned.content_kind
    from (
      select
        r.community_id, r.message_id, r.user_id, r.emoji, r.created_at,
        reactor.name as reactor_name, message.content as message_content,
        message.image_url as message_image_url, null::text as content_kind
      from public.message_reactions r
      join memberships membership on membership.community_id = r.community_id
      join public.community_messages message on message.id = r.message_id
      left join public.users reactor on reactor.id = r.user_id
      where r.created_at > membership.joined_at
      union all
      select
        r.community_id, r.content_id as message_id, r.user_id, r.emoji, r.created_at,
        reactor.name as reactor_name, card.title as message_content,
        null::text as message_image_url, r.content_kind
      from public.content_reactions r
      join memberships membership on membership.community_id = r.community_id
      left join content_titles card
        on card.id = r.content_id and card.kind = r.content_kind
      left join public.users reactor on reactor.id = r.user_id
      where r.created_at > membership.joined_at
    ) unioned
    order by unioned.community_id, unioned.created_at desc, unioned.message_id desc
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
    select distinct on (item.community_id)
      item.community_id, item.id, item.user_id, item.created_at, item.kind, item.title,
      author.name as author_name
    from content_items item
    left join public.users author on author.id = item.user_id
    order by item.community_id, item.created_at desc, item.id desc
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
      'reply_to_content_id', latest.reply_to_content_id,
      'reply_to_content_kind', reply_content.kind,
      'reply_to_content_title', reply_content.title,
      'deleted_at', latest.deleted_at, 'has_image', latest.image_url is not null
    ) end,
    -- Reactions preview only while nothing newer arrived: a later message takes
    -- the line back (the sidebar clears lastReaction on the same realtime
    -- event), whichever table the reaction lives in.
    'last_reaction', case
      when reaction.message_id is null then null
      when latest.created_at is not null and reaction.created_at <= latest.created_at then null
      else jsonb_build_object(
        'message_id', reaction.message_id, 'user_id', reaction.user_id,
        'emoji', reaction.emoji, 'created_at', reaction.created_at,
        'content_kind', reaction.content_kind,
        'reactor_name', reaction.reactor_name, 'message_content', reaction.message_content,
        'has_image', reaction.message_image_url is not null
      ) end,
    'last_content', case when content_item.id is null then null else jsonb_build_object(
      'id', content_item.id, 'kind', content_item.kind, 'title', content_item.title,
      'created_at', content_item.created_at, 'user_id', content_item.user_id,
      'author_name', content_item.author_name
    ) end
  )), '[]'::jsonb)
  from memberships membership
  left join member_counts counts using (community_id)
  left join message_stats stats using (community_id)
  left join content_stats content using (community_id)
  left join latest_messages latest using (community_id)
  left join latest_reactions reaction using (community_id)
  left join latest_content content_item using (community_id)
  left join content_titles reply_content on reply_content.id = latest.reply_to_content_id;
$function$;

comment on function public.get_sidebar_activity(uuid) is
  'Sidebar projection: per-community unread counts, last message, last reaction (message OR content card) and newest content item for a user.';

revoke all on function public.get_sidebar_activity(uuid) from public, anon, authenticated;
grant execute on function public.get_sidebar_activity(uuid) to service_role;
