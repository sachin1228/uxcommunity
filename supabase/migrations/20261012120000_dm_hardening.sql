-- ============================================================
-- Direct messages — production hardening.
--
-- Additive to 20261012100000_direct_messages.sql. Four concerns:
--
--   1. IDEMPOTENT SENDS. `client_nonce` (a per-logical-send UUID from the
--      client) with a unique (user_id, client_nonce) index, so a retry of a
--      send whose response was lost returns the ORIGINAL row instead of
--      inserting a duplicate — enforced by the database, not the route.
--
--   2. STABLE PAGINATION CURSORS. get_dm_message_page drops its
--      timestamp-only cursors for compound (created_at, id) row-value
--      comparisons. Two messages sharing a millisecond could previously
--      straddle a page boundary and one was skipped; the id tiebreak makes
--      the order total, so before/after paging can never skip or loop.
--
--   3. DATABASE-LEVEL INVARIANTS. A message's author must belong to its
--      conversation, a reply must reference a message from the same
--      conversation, and a reaction's user must belong (with a matching
--      denormalized conversation) — all enforced by triggers, so even a bug
--      in the service-role routes cannot write an incoherent row.
--
--   4. MONOTONIC READ MARKERS. mark_dm_conversation_read replaces the route's
--      "set marker to now()" update: the client sends the timestamp of the
--      newest message it has actually displayed, the function stores
--      greatest(existing, incoming), and only a participant can advance their
--      own side. Stale tabs and cross-device races can therefore never move a
--      marker backwards, and a message the client never saw cannot be
--      silently marked read.
-- ============================================================

-- ─── 1. Idempotency: client_nonce ───────────────────────────
-- Nullable so pre-existing rows and non-delegating callers stay valid; the
-- unique index treats NULLs as distinct, so only real (sender, nonce) pairs
-- collide. A duplicate insert raises 23505, which the send route turns into
-- "return the existing row".
alter table public.dm_messages
  add column if not exists client_nonce uuid;

create unique index if not exists idx_dm_messages_sender_nonce
  on public.dm_messages (user_id, client_nonce);

-- ─── 2. Message invariants ──────────────────────────────────
-- Author membership: a message can only be written by one of the two people
-- on its conversation — no impersonating through a crafted insert.
create or replace function public.dm_message_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conv_user_a uuid;
  conv_user_b uuid;
begin
  select c.user_a, c.user_b into conv_user_a, conv_user_b
    from public.dm_conversations c
   where c.id = new.conversation_id;

  if conv_user_a is null then
    raise exception 'Conversation does not exist' using errcode = '23503';
  end if;

  if new.user_id <> conv_user_a and new.user_id <> conv_user_b then
    raise exception 'Message author must be a participant of the conversation'
      using errcode = '23514';
  end if;

  if new.reply_to_id is not null and not exists (
    select 1
      from public.dm_messages m
     where m.id = new.reply_to_id
       and m.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply must reference a message in the same conversation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dm_messages_guard on public.dm_messages;
create trigger trg_dm_messages_guard
  before insert or update of user_id, conversation_id, reply_to_id
  on public.dm_messages
  for each row execute function public.dm_message_guard();

-- Reaction coherence: the reactor must belong to the message's conversation,
-- and the denormalized conversation_id must actually be that conversation —
-- a mismatched row would fan a reaction out to the wrong room.
create or replace function public.dm_reaction_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  msg_conversation_id uuid;
  conv_user_a uuid;
  conv_user_b uuid;
begin
  select m.conversation_id into msg_conversation_id
    from public.dm_messages m
   where m.id = new.message_id;

  if msg_conversation_id is null then
    raise exception 'Message does not exist' using errcode = '23503';
  end if;

  if new.conversation_id <> msg_conversation_id then
    raise exception 'Reaction conversation must match the message conversation'
      using errcode = '23514';
  end if;

  select c.user_a, c.user_b into conv_user_a, conv_user_b
    from public.dm_conversations c
   where c.id = msg_conversation_id;

  if new.user_id <> conv_user_a and new.user_id <> conv_user_b then
    raise exception 'Reactor must be a participant of the conversation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dm_message_reactions_guard on public.dm_message_reactions;
create trigger trg_dm_message_reactions_guard
  before insert or update
  on public.dm_message_reactions
  for each row execute function public.dm_reaction_guard();

-- ─── 3. Compound-cursor message page ────────────────────────
-- The 5-argument function is dropped, not replaced: a 7-argument overload
-- alongside it would make calls that rely on defaults ambiguous (42725),
-- the exact failure 20260926120000 fixed for the community page RPC.
drop function if exists public.get_dm_message_page(
  uuid, uuid, timestamptz, timestamptz, integer
);

-- Cursors are row values over (created_at, id) — the same total order the
-- index (conversation_id, created_at, id) and every ORDER BY use. A NULL
-- id degrades to the bound UUID sentinel (all-zero for `after`, all-ones for
-- `before`), which can only re-include equal-timestamp rows, never skip one;
-- the client always sends both halves anyway.
create or replace function public.get_dm_message_page(
  p_conversation_id uuid,
  p_user_id uuid,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_after timestamptz default null,
  p_after_id uuid default null,
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
  with participant as (
    select 1
      from public.dm_conversations c
     where c.id = p_conversation_id
       and (c.user_a = p_user_id or c.user_b = p_user_id)
  ),
  message_page as materialized (
    (
      select m.id, m.content, m.created_at, m.user_id, m.reply_to_id,
             m.image_url, m.deleted_at, m.edited_at
        from public.dm_messages m
       where p_after is not null
         and m.conversation_id = p_conversation_id
         and (m.created_at, m.id) > (p_after, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
         and exists (select 1 from participant)
       order by m.created_at asc, m.id asc
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    union all
    (
      select m.id, m.content, m.created_at, m.user_id, m.reply_to_id,
             m.image_url, m.deleted_at, m.edited_at
        from public.dm_messages m
       where p_after is null
         and m.conversation_id = p_conversation_id
         and (p_before is null or (m.created_at, m.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
         and exists (select 1 from participant)
       order by m.created_at desc, m.id desc
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.image_url, message.deleted_at,
    message.edited_at,
    case when author.id is null then null else jsonb_build_object(
      'name', author.name,
      'avatar_url', author_profile.avatar_url
    ) end as users,
    coalesce(reaction_groups.reactions, '[]'::jsonb) as reactions,
    case when reply.id is null then null else jsonb_build_object(
      'id', reply.id,
      'content', coalesce(reply.content, ''),
      'user_name', coalesce(reply_author.name, 'Unknown'),
      'user_id', reply.user_id
    ) end as reply_to
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as author_profile on author_profile.user_id = message.user_id
  left join public.dm_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('emoji', grouped.emoji, 'user_ids', grouped.user_ids)
      order by grouped.emoji
    ) as reactions
    from (
      select reaction.emoji, jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
        from public.dm_message_reactions as reaction
       where reaction.message_id = message.id
       group by reaction.emoji
    ) as grouped
  ) as reaction_groups on true
  order by message.created_at desc, message.id desc;
$$;

-- ─── 4. Monotonic read markers ──────────────────────────────
-- The route used to UPDATE the marker column to now(): a stale tab could
-- move it backwards over a fresh one, and "now" could swallow a message that
-- arrived between render and request. This function takes the timestamp of
-- the newest message the client actually displayed, stores the greatest of
-- (existing, incoming) — so markers only ever move forward — and refuses
-- non-participants. Returns the previous and effective markers.
create or replace function public.mark_dm_conversation_read(
  p_conversation_id uuid,
  p_user_id uuid,
  p_last_read_at timestamptz
)
returns table (
  previous_marked_at timestamptz,
  marked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv public.dm_conversations%rowtype;
  effective timestamptz;
begin
  select * into conv
    from public.dm_conversations c
   where c.id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  if conv.user_a <> p_user_id and conv.user_b <> p_user_id then
    raise exception 'Not a participant of this conversation' using errcode = '42501';
  end if;

  effective := greatest(
    coalesce(
      case when conv.user_a = p_user_id then conv.user_a_last_read_at
           else conv.user_b_last_read_at end,
      '-infinity'::timestamptz
    ),
    coalesce(p_last_read_at, now())
  );

  if conv.user_a = p_user_id then
    update public.dm_conversations
       set user_a_last_read_at = effective
     where id = p_conversation_id;
    return query select conv.user_a_last_read_at, effective;
  else
    update public.dm_conversations
       set user_b_last_read_at = effective
     where id = p_conversation_id;
    return query select conv.user_b_last_read_at, effective;
  end if;
end;
$$;

-- ─── 5. Grants: service_role only, as before ────────────────
revoke all on function public.get_dm_message_page(uuid, uuid, timestamptz, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_dm_message_page(uuid, uuid, timestamptz, uuid, timestamptz, uuid, integer)
  to service_role;

revoke all on function public.mark_dm_conversation_read(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_dm_conversation_read(uuid, uuid, timestamptz)
  to service_role;

revoke all on function public.dm_message_guard() from public, anon, authenticated;
revoke all on function public.dm_reaction_guard() from public, anon, authenticated;
