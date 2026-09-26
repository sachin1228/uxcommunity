-- ============================================================
-- Sidebar / unread scan bounds
--
-- Both read models behind the sidebar and the push badge used to
-- scan unbounded history per community and filter afterwards:
--
--   get_sidebar_activity      counted every message since joined_at
--                             (even when last_read_at was months later) and
--                             used DISTINCT ON over the full range to find
--                             each community's newest message, reaction and
--                             content item.
--   get_unread_message_totals counted every message since joined_at for every
--                             membership, for every push recipient.
--
-- On a mature community that is a range scan over the whole message history of
-- every community the caller belongs to — on every sidebar load, and once per
-- push recipient chunk.
--
-- This migration keeps the exact same output shape and semantics while making
-- the work proportional to what can still be unread:
--
--   1. Unread counts start at greatest(last_read_at, joined_at) instead of
--      joined_at, so the index range begins at the read watermark.
--      (`greatest` ignores NULLs, and joined_at is NOT NULL, so a member who
--      has never read anything is bounded by joined_at exactly as before.)
--   2. "Newest row per community" is resolved with one LIMIT 1 lateral per
--      table against the existing (community_id, created_at) indexes, instead
--      of scanning the range and sorting it.
--   3. Content titles are looked up only for the anchors actually referenced
--      by a reply or a card reaction, instead of materialising a union of all
--      four content tables on every call.
--
-- The `last_message` / `last_content` previews deliberately still use
-- joined_at, not the read watermark: the sidebar shows the newest activity even
-- after the member has read it.
--
-- Re-runnable: create or replace / if not exists only, no data changes.
-- ============================================================

-- ─── Newest-reaction lookups ────────────────────────────────────────────────
-- `latest_reactions` now asks each table for its single newest reaction per
-- community. The existing indexes are (community_id) only, which narrows to the
-- community but then has to sort every reaction it ever received, so the
-- per-community lookup gets an index that already carries the ordering.

create index if not exists idx_message_reactions_community_created
  on public.message_reactions (community_id, created_at desc);

create index if not exists idx_content_reactions_community_created
  on public.content_reactions (community_id, created_at desc);

-- community_events only indexed (community_id, event_date); "newest event"
-- and the unread-event count both order by created_at.
create index if not exists idx_community_events_community_created
  on public.community_events (community_id, created_at desc);

-- ─── get_sidebar_activity ───────────────────────────────────────────────────

create or replace function public.get_sidebar_activity(p_user_id uuid)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with memberships as (
    select
      cm.community_id,
      cm.joined_at,
      cm.last_read_at,
      cm.archived_at,
      -- Where counting can start: everything before this is already read (or
      -- predates the membership), so it can never contribute to unread.
      greatest(cm.last_read_at, cm.joined_at) as unread_since,
      (c.enabled_tabs is null or 'threads' = any (c.enabled_tabs)) as threads_enabled,
      (c.enabled_tabs is null or 'events' = any (c.enabled_tabs)) as events_enabled,
      (c.enabled_tabs is null or 'resources' = any (c.enabled_tabs)) as resources_enabled,
      coalesce(c.showcase_enabled, true) as showcase_enabled
    from public.community_members cm
    join public.communities c on c.id = cm.community_id
    where cm.user_id = p_user_id
  ),
  member_counts as (
    select cm.community_id, count(*)::integer as member_count
    from public.community_members cm
    join memberships m on m.community_id = cm.community_id
    group by cm.community_id
  ),
  message_stats as (
    select m.community_id,
      count(*)::integer as unread_count,
      count(*) filter (
        where exists (
          select 1
          from jsonb_array_elements(coalesce(m.mentions, '[]'::jsonb)) as mentioned
          where mentioned ->> 'user_id' = p_user_id::text
        )
      )::integer as unread_mention_count
    from public.community_messages m
    join memberships membership on membership.community_id = m.community_id
    where m.user_id <> p_user_id
      and m.created_at > membership.unread_since
    group by m.community_id
  ),
  -- Newest message per community: one index step per community instead of a
  -- distinct-on over everything since the member joined.
  latest_messages as (
    select
      membership.community_id, latest.id, latest.content, latest.created_at, latest.user_id,
      latest.reply_to_id, latest.reply_to_content_id, latest.deleted_at, latest.image_url,
      sender.name as sender_name, parent_sender.name as reply_sender_name
    from memberships membership
    left join lateral (
      select m.id, m.content, m.created_at, m.user_id, m.reply_to_id,
             m.reply_to_content_id, m.deleted_at, m.image_url
      from public.community_messages m
      where m.community_id = membership.community_id
        and m.created_at > membership.joined_at
      order by m.created_at desc, m.id desc
      limit 1
    ) latest on true
    left join public.users sender on sender.id = latest.user_id
    left join public.community_messages parent on parent.id = latest.reply_to_id
    left join public.users parent_sender on parent_sender.id = parent.user_id
  ),
  -- Newest reaction per community, once per anchor table. content_kind is null
  -- for message reactions, so the sidebar can render a card reaction with the
  -- card's own vocabulary.
  latest_message_reaction as (
    select
      membership.community_id, reaction.message_id, reaction.user_id, reaction.emoji,
      reaction.created_at, reactor.name as reactor_name,
      message.content as message_content, message.image_url as message_image_url
    from memberships membership
    left join lateral (
      select r.message_id, r.user_id, r.emoji, r.created_at
      from public.message_reactions r
      where r.community_id = membership.community_id
        and r.created_at > membership.joined_at
      order by r.created_at desc, r.message_id desc
      limit 1
    ) reaction on true
    left join public.community_messages message on message.id = reaction.message_id
    left join public.users reactor on reactor.id = reaction.user_id
  ),
  latest_content_reaction as (
    select
      membership.community_id, reaction.content_id as message_id, reaction.content_kind,
      reaction.user_id, reaction.emoji, reaction.created_at, reactor.name as reactor_name
    from memberships membership
    left join lateral (
      select r.content_id, r.content_kind, r.user_id, r.emoji, r.created_at
      from public.content_reactions r
      where r.community_id = membership.community_id
        and r.created_at > membership.joined_at
      order by r.created_at desc, r.content_id desc
      limit 1
    ) reaction on true
    left join public.users reactor on reactor.id = reaction.user_id
  ),
  -- Only the content rows something actually points at: a reply anchor or a
  -- card reaction. Unioning all four tables unconditionally is what made a
  -- reaction preview cost a scan of every thread/showcase/resource/event.
  pinned_content_ids as (
    select latest.reply_to_content_id as id
    from latest_messages latest
    where latest.reply_to_content_id is not null
    union
    select reaction.message_id as id
    from latest_content_reaction reaction
    where reaction.message_id is not null
  ),
  content_titles as (
    select 'thread'::text as kind, t.id, t.title
    from public.community_threads t
    join pinned_content_ids pinned on pinned.id = t.id
    union all
    select 'showcase'::text, s.id, s.title
    from public.community_showcase_posts s
    join pinned_content_ids pinned on pinned.id = s.id
    union all
    select 'resource'::text, r.id, r.title
    from public.community_resources r
    join pinned_content_ids pinned on pinned.id = r.id
    union all
    select 'event'::text, e.id, e.title
    from public.community_events e
    join pinned_content_ids pinned on pinned.id = e.id
  ),
  -- Newest reaction across BOTH anchors: a chat message or a content card.
  latest_reactions as (
    select distinct on (unioned.community_id)
      unioned.community_id, unioned.message_id, unioned.user_id, unioned.emoji,
      unioned.created_at, unioned.reactor_name, unioned.message_content,
      unioned.message_image_url, unioned.content_kind
    from (
      select
        community_id, message_id, user_id, emoji, created_at, reactor_name,
        message_content, message_image_url, null::text as content_kind
      from latest_message_reaction
      where message_id is not null
      union all
      select
        reaction.community_id, reaction.message_id, reaction.user_id, reaction.emoji,
        reaction.created_at, reaction.reactor_name, card.title as message_content,
        null::text as message_image_url, reaction.content_kind
      from latest_content_reaction reaction
      left join content_titles card
        on card.id = reaction.message_id and card.kind = reaction.content_kind
      where reaction.message_id is not null
    ) unioned
    order by unioned.community_id, unioned.created_at desc, unioned.message_id desc
  ),
  -- Unread content: bounded by the same watermark as the message counts, and
  -- skipped entirely for areas the community has disabled.
  content_items as (
    select membership.community_id, t.user_id, t.created_at
    from memberships membership
    join public.community_threads t on t.community_id = membership.community_id
    where membership.threads_enabled and t.created_at > membership.unread_since
    union all
    select membership.community_id, s.user_id, s.created_at
    from memberships membership
    join public.community_showcase_posts s on s.community_id = membership.community_id
    where membership.showcase_enabled and s.created_at > membership.unread_since
    union all
    select membership.community_id, r.user_id, r.created_at
    from memberships membership
    join public.community_resources r on r.community_id = membership.community_id
    where membership.resources_enabled and r.created_at > membership.unread_since
    union all
    select membership.community_id, e.user_id, e.created_at
    from memberships membership
    join public.community_events e on e.community_id = membership.community_id
    where membership.events_enabled and e.created_at > membership.unread_since
  ),
  content_stats as (
    select item.community_id,
      count(*)::integer as unread_content_count
    from content_items item
    where item.user_id <> p_user_id
    group by item.community_id
  ),
  -- Newest content item per community — preview only, so it keeps showing the
  -- newest item even after it has been read.
  latest_content as (
    select
      membership.community_id, content_item.id, content_item.kind, content_item.title,
      content_item.created_at, content_item.user_id, author.name as author_name
    from memberships membership
    left join lateral (
      select candidate.kind, candidate.id, candidate.title, candidate.created_at, candidate.user_id
      from (
        (select 'thread'::text as kind, t.id, t.title, t.created_at, t.user_id
         from public.community_threads t
         where membership.threads_enabled
           and t.community_id = membership.community_id
           and t.created_at > membership.joined_at
         order by t.created_at desc, t.id desc
         limit 1)
        union all
        (select 'showcase'::text, s.id, s.title, s.created_at, s.user_id
         from public.community_showcase_posts s
         where membership.showcase_enabled
           and s.community_id = membership.community_id
           and s.created_at > membership.joined_at
         order by s.created_at desc, s.id desc
         limit 1)
        union all
        (select 'resource'::text, r.id, r.title, r.created_at, r.user_id
         from public.community_resources r
         where membership.resources_enabled
           and r.community_id = membership.community_id
           and r.created_at > membership.joined_at
         order by r.created_at desc, r.id desc
         limit 1)
        union all
        (select 'event'::text, e.id, e.title, e.created_at, e.user_id
         from public.community_events e
         where membership.events_enabled
           and e.community_id = membership.community_id
           and e.created_at > membership.joined_at
         order by e.created_at desc, e.id desc
         limit 1)
      ) candidate
      order by candidate.created_at desc, candidate.id desc
      limit 1
    ) content_item on true
    left join public.users author on author.id = content_item.user_id
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
  'Sidebar projection: per-community unread counts, last message, last reaction (message OR content card) and newest content item for a user. Unread scans are bounded by the read watermark; newest-row lookups use LIMIT 1 laterals.';

revoke all on function public.get_sidebar_activity(uuid) from public, anon, authenticated;
grant execute on function public.get_sidebar_activity(uuid) to service_role;

-- ─── get_unread_message_totals ──────────────────────────────────────────────
-- The push badge total. Same unread definition as above (own messages excluded,
-- everything since the later of joined_at / last_read_at), but the count now
-- starts where unread can begin instead of scanning from joined_at.

create or replace function public.get_unread_message_totals(p_user_ids uuid[])
returns table (user_id uuid, unread integer)
language sql
stable
security definer
set search_path to ''
as $function$
  select cm.user_id, coalesce(sum(counts.unread), 0)::integer as unread
  from public.community_members cm
  left join lateral (
    select count(*)::integer as unread
    from public.community_messages m
    where m.community_id = cm.community_id
      and m.user_id <> cm.user_id
      and m.created_at > greatest(cm.last_read_at, cm.joined_at)
  ) counts on true
  where cm.user_id = any(p_user_ids)
    and cm.archived_at is null
  group by cm.user_id;
$function$;

comment on function public.get_unread_message_totals(uuid[]) is
  'Icon-badge totals per member; scans start at greatest(last_read_at, joined_at) so the count is bounded by what can still be unread.';

revoke all on function public.get_unread_message_totals(uuid[]) from public, anon, authenticated;
grant execute on function public.get_unread_message_totals(uuid[]) to service_role;
