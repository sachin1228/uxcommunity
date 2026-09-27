-- ============================================================
-- C-1 — Community member counts: materialized counter
--
-- Both community list read models counted membership rows per request:
--
--   get_sidebar_activity   `member_counts` counted every row of
--                          community_members for each of the caller's
--                          communities (the sidebar, and the mobile list
--                          reconcile that reads the same RPC).
--   get_all_communities    `membership_aggregates` grouped the WHOLE
--                          community_members table per Explore load.
--
-- With 30 communities of 100k members that is millions of rows examined to
-- render one sidebar, and it grows linearly with every join.
--
-- This migration makes the count a value on the community row, kept correct by
-- the database itself:
--
--   1. communities.member_count — populated from community_members, then
--      maintained on every membership mutation.
--   2. AFTER INSERT / DELETE triggers on community_members. AFTER, so the
--      counter only moves for a row that really landed, and a rolled-back
--      transaction rolls the counter back with it. The counter update is
--      `set member_count = member_count + 1`, a row-locking read-modify-write,
--      so two concurrent joins serialise on the community row and produce
--      100 + 2 rather than 100 + 1 twice.
--   3. Because it lives in the database, no write path can bypass it — not the
--      ~20 routes that upsert/delete memberships, not the bulk admin fan-out,
--      and not the ON DELETE CASCADE from a deleted user or community (the
--      cascade fires the same row triggers).
--
-- Read paths then stop counting: get_sidebar_activity returns
-- communities.member_count, and get_all_communities reads it plus one
-- (community_id, user_id) index probe for the caller's own "joined" flag.
--
-- Re-runnable: add column if not exists, create or replace, drop trigger if
-- exists, and a backfill that updates zero rows the second time.
--
-- Deploy note: the column and the RPCs land in the same migration, so apply
-- this before deploying app code that selects communities.member_count
-- (read-models.ts, preview.ts, event-chat.ts, join/[token], admin routes).
-- ============================================================


-- ─── 1. The counter ─────────────────────────────────────────
-- ADD COLUMN with a non-null default is metadata-only on PostgreSQL 11+
-- (no table rewrite), so this is cheap even on a large communities table.

alter table public.communities
  add column if not exists member_count integer not null default 0;

comment on column public.communities.member_count is
  'Number of rows in community_members for this community. Maintained by the trg_community_members_count* triggers on community_members; never write it from application code.';


-- ─── 2. Backfill ────────────────────────────────────────────
-- One pass, and only over rows that are actually wrong, so re-running is a
-- no-op. Communities with no membership rows get 0 (they were 0 already, but
-- this also repairs a count left stale by an older environment).
--
-- This is the one expensive statement in the file: it groups community_members
-- by community_id, and the whole migration holds the lock the ADD COLUMN took.
-- Run it in a low-traffic window on a large production database.

update public.communities as c
set member_count = coalesce(counted.total, 0)
from (
  select community.id,
         count(member.user_id)::integer as total
  from public.communities as community
  left join public.community_members as member
    on member.community_id = community.id
  group by community.id
) as counted
where counted.id = c.id
  and c.member_count is distinct from coalesce(counted.total, 0);


-- ─── 3. Keeping the counter correct ─────────────────────────
-- security definer so the increment cannot depend on the caller's privileges
-- on communities (membership writes come in with the service role, but a
-- cascade from users/communities must work the same way), and an empty
-- search_path so the update can only ever touch public.communities.

create or replace function public.sync_community_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    update public.communities
       set member_count = member_count + 1
     where id = new.community_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.communities
       set member_count = member_count - 1
     where id = old.community_id;
    return old;
  end if;

  -- UPDATE: a membership moved from one community to another. Nothing in the
  -- application writes community_id, but the trigger below exists so that a
  -- future one cannot silently leave both counters wrong. The pair is applied
  -- old-then-new so two moves over the same two communities take their rows in
  -- the same order.
  update public.communities
     set member_count = member_count - 1
   where id = old.community_id;

  update public.communities
     set member_count = member_count + 1
   where id = new.community_id;

  return new;
end;
$function$;

comment on function public.sync_community_member_count() is
  'Keeps communities.member_count equal to the number of community_members rows for the community. Fired by trg_community_members_count (INSERT/DELETE) and trg_community_members_count_move (community_id changes).';

drop trigger if exists trg_community_members_count on public.community_members;

create trigger trg_community_members_count
  after insert or delete on public.community_members
  for each row execute function public.sync_community_member_count();

-- Only when the row actually changes community: `update of ...` drops every
-- role / notifications_muted / last_read_at / archived_at write before the
-- function is called, so marking a community read costs nothing extra.
drop trigger if exists trg_community_members_count_move on public.community_members;

create trigger trg_community_members_count_move
  after update of community_id on public.community_members
  for each row
  when (old.community_id is distinct from new.community_id)
  execute function public.sync_community_member_count();


-- ─── 4. Read paths ──────────────────────────────────────────
-- Row shape of both functions is unchanged; only where member_count comes from
-- changes. Everything else in the bodies is byte-for-byte the previous
-- definition (sidebar: 20260926120000_sidebar_scan_bounds.sql, explore:
-- 20260924130000_event_chat_communities.sql).

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
      -- The materialized counter (see 20260927120000_community_member_count.sql),
      -- so displaying it never scans the community's membership rows.
      coalesce(c.member_count, 0) as member_count,
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
    'member_count', membership.member_count,
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
  left join message_stats stats using (community_id)
  left join content_stats content using (community_id)
  left join latest_messages latest using (community_id)
  left join latest_reactions reaction using (community_id)
  left join latest_content content_item using (community_id)
  left join content_titles reply_content on reply_content.id = latest.reply_to_content_id;
$function$;

comment on function public.get_sidebar_activity(uuid) is
  'Sidebar projection: per-community unread counts, last message, last reaction (message OR content card) and newest content item for a user. Unread scans are bounded by the read watermark; newest-row lookups use LIMIT 1 laterals. member_count is read from communities.member_count, never counted from community_members.';

revoke all on function public.get_sidebar_activity(uuid) from public, anon, authenticated;
grant execute on function public.get_sidebar_activity(uuid) to service_role;

create or replace function public.get_all_communities(p_user_id uuid)
returns table (
  id uuid,
  name text,
  type text,
  image_url text,
  lottie_url text,
  lottie_format text,
  description text,
  is_private boolean,
  member_count bigint,
  joined boolean,
  can_join boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with profile as (
    select
      dp.city_id,
      dp.sector_id,
      el.id as experience_level_id,
      jt.id as job_title_id
    from public.designer_profiles as dp
    left join public.experience_levels as el
      on el.slug = dp.experience_level::text
    left join public.job_titles as jt
      on jt.slug = dp.job_title::text
    where dp.user_id = p_user_id
    limit 1
  )
  select
    c.id,
    c.name,
    c.type,
    coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'interest' then interest.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ) as image_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_url
        when 'sector' then sector.lottie_url
        when 'interest' then interest.lottie_url
        when 'experience_level' then experience.lottie_url
        when 'job_title' then job.lottie_url
      end,
      c.lottie_url
    ) as lottie_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_format
        when 'sector' then sector.lottie_format
        when 'interest' then interest.lottie_format
        when 'experience_level' then experience.lottie_format
        when 'job_title' then job.lottie_format
      end,
      c.lottie_format
    ) as lottie_format,
    c.description,
    coalesce(c.is_private, false) as is_private,
    -- The materialized counter (20260927120000_community_member_count.sql):
    -- the Explore directory used to aggregate the whole membership table here.
    c.member_count::bigint,
    -- "joined" is a membership existence test for the caller only, answered by
    -- the (community_id, user_id) primary key — one index probe per community.
    exists (
      select 1
      from public.community_members cm
      where cm.community_id = c.id
        and cm.user_id = p_user_id
    ) as joined,
    case
      when c.type in ('interest', 'general', 'user') then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      when c.type = 'job_title' then profile.job_title_id = c.reference_id
      else false
    end as can_join
  from public.communities as c
  left join profile on true
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.design_interests as interest
    on c.type = 'interest' and interest.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  where c.is_active = true
    -- An empty community is not a directory entry: this keeps the row the
    -- old INNER JOIN to the membership aggregate used to drop, without
    -- aggregating anything.
    and c.member_count > 0
    -- Event group chats are an event's room, not a community to browse.
    and c.type <> 'event'
    and case c.type
      when 'city' then city.id is not null
      when 'sector' then sector.id is not null
      when 'interest' then interest.id is not null
      when 'experience_level' then experience.id is not null
      when 'job_title' then job.id is not null
      else true
    end
  order by c.name;
$$;

comment on function public.get_all_communities(uuid) is
  'Returns the response-ready active community explore list in one query (event group chats excluded). member_count is read from communities.member_count rather than aggregated from community_members.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;
