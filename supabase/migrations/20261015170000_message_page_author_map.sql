-- The community message page stops repeating the author on every row.
--
-- WHY (measured, see docs/supabase-egress-audit.md §4 #4)
--   Every row of the page carried its own `users` object — the author's name,
--   avatar and designation, rebuilt from three joins per message. On a 50-row
--   page that is up to 50 copies of the same small object, and the audit
--   measured the column at 1,839 B for a 13-row page (26% of the whole page):
--   the payload grew with the number of ROWS rather than with the number of
--   PEOPLE in the room.
--
-- WHAT — and why it is not simply deleted
--   The audit's suggestion was to drop it and let the client resolve authors
--   from "the members it already has". That premise does not hold in this
--   codebase: the chat's member list comes from the community read model, which
--   selects the TEN most recent members (lib/communities/read-models.ts), and a
--   room's messages are written by everyone — including people who have since
--   left. Deleting the payload would have turned most names in a busy room into
--   the "Member" fallback.
--
--   So the authors stay server-resolved, ONCE per page: `authors` is a
--   `{ "<user_id>": { name, avatar_url, designation } }` map covering the
--   distinct authors this page actually shows, hung on a single row exactly like
--   `content_reactions` (20260928170000_message_page_content_reactions_once).
--   A page therefore pays per AUTHOR rather than per message, and the client
--   fills each message's `users` from the map before anything renders
--   (lib/communities/read-models.ts) — so every component downstream, and the
--   message cache, keep the shape they have always had.
--
-- RETURN TYPE
--   `users` leaves the column list and `authors` joins it, which Postgres cannot
--   do in place, so the function is dropped and recreated — with the SAME nine
--   arguments, so 20260929090000's single-overload guarantee still holds and
--   every existing positional or named call resolves unchanged.
--
-- DEPLOYMENT ORDER (APP FIRST — the reverse of the compound-cursor migration,
-- and for a stated reason)
--   * App first (quiet): the new client reads the author map when the RPC sends
--     one and leaves a per-row `users` alone when it does not, so against an
--     un-applied migration it behaves exactly as before, just with the extra
--     bytes.
--   * Migration first (visible, not broken): the older deployed client finds no
--     per-row `users` and falls back to its "Member" placeholder for author
--     names until the new build is out. Messages, replies and reactions all keep
--     working; only names dim.
--   The author map is additive until the client reads it, so either order is
--   recoverable — app-first simply has no visible window.

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
  reactions jsonb,
  reply_to jsonb,
  reply_to_content jsonb,
  content_reactions jsonb,
  authors jsonb
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
  ),
  -- The distinct authors this page shows. Kept separate from `message_page`
  -- because a set of ids is what the author aggregate below reads: without it,
  -- the aggregate would be correlated to each row and rebuild the same map per
  -- message — the repetition this migration removes.
  interesting_authors as (
    select distinct message_page.user_id
    from message_page
    where message_page.user_id is not null
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.reply_to_content_id, message.image_url,
    message.deleted_at, message.edited_at,
    message.deleted_by, message.deleted_by_role,
    coalesce(message.mentions, '[]'::jsonb) as mentions,
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
    end as content_reactions,
    -- The page's authors, one entry each, on that same single row. The joins and
    -- the designation rule are the ones the per-row blob used, so a name, avatar
    -- or designation cannot differ from what the page used to carry.
    case
      when row_number() over (order by message.created_at desc, message.id desc) = 1
        then coalesce(page_authors.authors, '{}'::jsonb)
      else null
    end as authors
  from message_page as message
  left join public.community_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
  left join public.community_threads as rc_thread on rc_thread.id = message.reply_to_content_id
  left join public.community_showcase_posts as rc_showcase on rc_showcase.id = message.reply_to_content_id
  left join public.community_resources as rc_resource on rc_resource.id = message.reply_to_content_id
  left join public.community_events as rc_event on rc_event.id = message.reply_to_content_id
  -- Uncorrelated: reads the CTE, so the whole page's authors are resolved in one
  -- pass however many rows the page holds.
  left join lateral (
    select jsonb_object_agg(page_author.user_id::text, page_author.author) as authors
    from (
      select
        author.id as user_id,
        jsonb_build_object(
          'name', author.name,
          'avatar_url', profile.avatar_url,
          'designation', case
            when experience.name is null then null
            when experience.name ~* '^heads\s+of\b' then regexp_replace(experience.name, '^heads', 'Head', 'i')
            else regexp_replace(split_part(experience.name, '(', 1), 's\s*$', '')
          end
        ) as author
      from interesting_authors as page_author_id
      join public.users as author on author.id = page_author_id.user_id
      left join public.designer_profiles as profile on profile.user_id = page_author_id.user_id
      left join public.experience_levels as experience on experience.slug = profile.experience_level::text
    ) as page_author
  ) as page_authors on true
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

comment on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) is
  'One page of a community team chat, newest first (or oldest-first catch-up with p_after). Rows carry the message, its grouped reactions, reply previews and mentions; the page''s content-reaction groups ride once (content_reactions) and its distinct authors ride once as a `{ user_id: { name, avatar_url, designation } }` map (authors), both attached to the first row of the page.';

revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) from public;
revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) from anon;
revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) from authenticated;
grant execute on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[], uuid, uuid) to service_role;
