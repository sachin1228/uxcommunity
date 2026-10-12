-- ============================================================
-- Community message pagination — stable compound (created_at, id) cursor.
--
-- WHY
--   get_community_message_page paged on `created_at` ALONE while ordering by
--   `(created_at desc, id desc)`. A single timestamp can hold several messages,
--   so a burst that straddled a page boundary could be split: the cursor row's
--   timestamp was used as a strict `<` bound and the equal-timestamp rows on
--   the far side of the boundary were never returned again. Paging upward could
--   therefore drop a message, and the catch-up path could skip rows too.
--
--   The DM page (get_dm_message_page) was hardened to compound row-value
--   cursors in 20261012120000_dm_hardening.sql for exactly this reason:
--
--     "Two messages sharing a millisecond could previously straddle a page
--      boundary and one was skipped; the id tiebreak makes the order total, so
--      before/after paging can never skip or loop."
--
--   This migration applies the same fix to the community page. The timestamp
--   halves (p_before / p_after) keep working on their own — a caller that omits
--   the id halves degrades to the previous behaviour, which can only re-include
--   equal-timestamp rows, never skip them (a NULL id degrades to the all-zero
--   sentinel for `after` and the all-ones sentinel for `before`).
--
-- SHAPE OF THE FIX
--   The new arguments are appended AFTER p_content_ids, and every one of them
--   has a default, so:
--     * a positional 6- or 7-argument call (the existing SQL tests, and any
--       older deployed caller) still resolves to this function;
--     * a named-argument call that omits the new halves resolves too.
--   The previous signature is DROPPED first — never coexisting with the new one
--   — because overlapping defaults on two overloads is precisely the
--   "function ... is not unique" (42725) failure 20260929090000 fixed.
--
-- DEPLOYMENT ORDER (both directions are safe)
--   * Migration first: an app build that still sends seven named arguments
--     resolves to this function through its defaults.
--   * App first: the new build's nine-argument call fails with PGRST202 against
--     the un-migrated function, which the route treats as "compound cursors are
--     not available yet" and retries with the timestamp halves only
--     (see apps/web/lib/communities/message-cursor-support.ts).
--
-- COST
--   `create index` (not CONCURRENTLY) takes a SHARE lock that blocks writes for
--   the build. public.community_messages held 430 rows when this was authored,
--   so the build is instant. On a much larger table, run the index statement by
--   hand with CONCURRENTLY first — `if not exists` then makes this migration a
--   no-op for it.
-- ============================================================

-- ─── 1. The index the compound cursor pages on ──────────────────────────────
-- Matches the order of BOTH branches: a forward scan serves
-- `order by created_at asc, id asc` (catch-up) and a backward scan serves
-- `order by created_at desc, id desc` (newest page / older pages).
create index if not exists idx_community_messages_room_time_id
  on public.community_messages (community_id, created_at asc, id asc);

-- ─── 2. Replace the timestamp-only page function ────────────────────────────
-- Dropped, not replaced: Postgres cannot change a function's signature or
-- return type in place, and a second overload would be ambiguous. Both drop
-- statements are `if exists` so the file is re-runnable by hand.
drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[]
);

drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid
);

create function public.get_community_message_page(
  p_community_id uuid,
  p_user_id uuid,
  p_history_start timestamptz,
  p_before timestamptz default null,
  p_after timestamptz default null,
  p_limit integer default 50,
  p_content_ids uuid[] default null,
  -- The id halves of the compound cursor, appended so every existing
  -- positional call still resolves through the defaults above.
  p_before_id uuid default null,
  p_after_id uuid default null
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
  deleted_by uuid,
  deleted_by_role text,
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
    -- Catch-up: everything strictly newer than the cursor, oldest first, so a
    -- draining client can walk forward page by page from where it stopped.
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.reply_to_content_id, message.image_url,
        message.deleted_at, message.edited_at, message.deleted_by,
        message.deleted_by_role, message.mentions
      from public.community_messages as message
      where p_after is not null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        -- Row-value comparison against the compound cursor: the id tiebreak
        -- makes the order total, so equal-timestamp rows on either side of the
        -- boundary are never lost. A NULL id degrades to the all-zero sentinel,
        -- which can only re-include equal-timestamp rows.
        and (message.created_at, message.id)
              > (p_after, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
      order by message.created_at asc, message.id asc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    union all
    -- Newest page (no cursor) or the page above an older cursor, newest first.
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.reply_to_content_id, message.image_url,
        message.deleted_at, message.edited_at, message.deleted_by,
        message.deleted_by_role, message.mentions
      from public.community_messages as message
      where p_after is null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and (p_before is null
             or (message.created_at, message.id)
                  < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
      order by message.created_at desc, message.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  ),
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
    message.deleted_by, message.deleted_by_role,
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
    -- Page-level aggregate, emitted once on the first row of the page.
    case
      when row_number() over (order by message.created_at desc, message.id desc) = 1
        then coalesce(content_reaction_groups.groups, '[]'::jsonb)
      else null
    end as content_reactions
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as profile on profile.user_id = message.user_id
  left join public.experience_levels as experience on experience.slug = profile.experience_level::text
  left join public.community_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
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

revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) from public;
revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) from anon;
revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) from authenticated;
grant execute on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) to service_role;
