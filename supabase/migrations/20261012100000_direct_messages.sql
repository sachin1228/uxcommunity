-- ============================================================
-- Direct messages — private 1:1 chat between any two members
--
-- Separate from the community chat on purpose (the feature also stays
-- separate in the app: /api/dm/*, lib/direct-messages/*, components/
-- direct-messages/*). A conversation is a canonical ORDERED PAIR of user
-- ids (user_a < user_b) with one row per pair, enforced by a unique
-- constraint — so "get or create" is a single race-safe upsert, there is
-- no participant join table to keep in sync, and the per-side read
-- markers can live as two columns on the row.
--
--   dm_conversations        one row per (user_a, user_b) pair
--   dm_messages             the messages (text / image / reply / soft-delete)
--   dm_message_reactions    one reaction per user per message (like the
--                           community chat's message_reactions)
--
-- `last_message_at` is maintained by an insert trigger on dm_messages rather
-- than by callers, so every write path (send, retry, future imports) keeps
-- the list ordering and unread maths correct without trusting the route.
--
-- PRIVACY: these tables are service-role only — RLS on, no grants to anon or
-- authenticated, and deliberately NOT added to the supabase_realtime
-- publication (the app's realtime is the custom Worker in apps/realtime,
-- which authorizes every socket; a private table in a publication would be
-- an information-exposure footgun with no consumer).
-- ============================================================

-- ─── 1. Conversations: one ordered pair ─────────────────────
create table if not exists public.dm_conversations (
  id                    uuid primary key default gen_random_uuid(),
  -- The pair is stored canonically ordered (user_a < user_b) so a pair has
  -- exactly one row no matter who starts the conversation.
  user_a                uuid not null references public.users (id) on delete cascade,
  user_b                uuid not null references public.users (id) on delete cascade,
  created_at            timestamptz not null default now(),
  -- Newest message time — drives list ordering; only non-empty conversations
  -- (one with at least one message) surface in the list.
  last_message_at       timestamptz,
  -- Per-side read markers (same shape as community_members.last_read_at).
  user_a_last_read_at   timestamptz,
  user_b_last_read_at   timestamptz,
  constraint dm_conversations_pair_order check (user_a < user_b),
  constraint dm_conversations_pair_unique unique (user_a, user_b)
);

comment on table public.dm_conversations is
  '1:1 DM conversations — canonical ordered pair, one row per pair.';

-- ─── 2. Messages ────────────────────────────────────────────
create table if not exists public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  -- Nullable: image-only messages and soft-deleted rows have none.
  content         text,
  image_url       text,
  reply_to_id     uuid references public.dm_messages (id) on delete set null,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint dm_messages_content_len check (
    content is null or char_length(content) between 1 and 2000
  ),
  -- A row must carry something to show unless it is a tombstone.
  constraint dm_messages_payload_present check (
    deleted_at is not null or image_url is not null or content is not null
  )
);

comment on table public.dm_messages is
  'Direct messages. Soft-deleted rows keep their shape with content and image wiped (deleted_at set).';

create index if not exists idx_dm_messages_conversation_time
  on public.dm_messages (conversation_id, created_at asc, id asc);

create index if not exists idx_dm_messages_reply_to
  on public.dm_messages (reply_to_id)
  where reply_to_id is not null;

-- ─── 3. Reactions ───────────────────────────────────────────
create table if not exists public.dm_message_reactions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.dm_messages (id) on delete cascade,
  -- Denormalized so realtime payloads and cleanup can address the
  -- conversation without joining back through the message.
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  emoji           text not null check (char_length(emoji) <= 10),
  created_at      timestamptz not null default now(),
  constraint dm_message_reactions_message_user_unique unique (message_id, user_id)
);

comment on table public.dm_message_reactions is
  'One reaction per user per DM message; desired-state upserts keep rapid toggles idempotent.';

-- ─── 4. Conversation ordering (per side) ────────────────────
create index if not exists idx_dm_conversations_user_a
  on public.dm_conversations (user_a, last_message_at desc nulls last);

create index if not exists idx_dm_conversations_user_b
  on public.dm_conversations (user_b, last_message_at desc nulls last);

-- ─── 5. last_message_at trigger ─────────────────────────────
-- Every insert bumps the conversation's newest-message time; `greatest`
-- keeps an out-of-order insert (clock skew, backfill) from moving it
-- backwards.
create or replace function public.dm_messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.dm_conversations
     set last_message_at = greatest(
           coalesce(last_message_at, new.created_at),
           new.created_at
         )
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_dm_messages_touch_conversation on public.dm_messages;
create trigger trg_dm_messages_touch_conversation
  after insert on public.dm_messages
  for each row execute function public.dm_messages_touch_conversation();

-- ─── 6. Access control: service-role only ───────────────────
-- The web app reads and writes with the service-role client after its own
-- participant checks, exactly like push_throttle (20260918140000). Nothing
-- in the app ships an anon/authenticated key, so no client role gets a grant.
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_message_reactions enable row level security;

revoke all on table public.dm_conversations from anon, authenticated;
revoke all on table public.dm_messages from anon, authenticated;
revoke all on table public.dm_message_reactions from anon, authenticated;

-- ─── 7. RPC: get or create a conversation ───────────────────
-- Normalizes the pair inside the function so callers cannot get the
-- ordering wrong. Race-safe: the conflict clause makes concurrent
-- "start a chat" taps collapse onto one row instead of erroring.
create or replace function public.get_or_create_dm_conversation(
  p_me uuid,
  p_peer uuid
)
returns table (
  id uuid,
  user_a uuid,
  user_b uuid,
  created_at timestamptz,
  last_message_at timestamptz,
  my_last_read_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
-- The ON CONFLICT target names columns that are also OUT parameter names
-- (user_a/user_b of the returned row); resolve those references as columns.
#variable_conflict use_column
declare
  pair_a uuid := least(p_me, p_peer);
  pair_b uuid := greatest(p_me, p_peer);
begin
  if p_me = p_peer then
    raise exception 'Cannot start a conversation with yourself' using errcode = '22023';
  end if;

  insert into public.dm_conversations (user_a, user_b)
  values (pair_a, pair_b)
  on conflict (user_a, user_b) do nothing;

  return query
    select c.id, c.user_a, c.user_b, c.created_at, c.last_message_at,
           case when c.user_a = p_me then c.user_a_last_read_at
                else c.user_b_last_read_at end
      from public.dm_conversations c
     where c.user_a = pair_a
       and c.user_b = pair_b;
end;
$$;

-- ─── 8. RPC: the conversation list ──────────────────────────
-- One round trip for the whole list: peer identity, last-message preview
-- and the viewer's unread count per conversation. Empty conversations
-- (no message yet) stay out until the first message lands.
create or replace function public.get_dm_conversations(
  p_user_id uuid
)
returns table (
  conversation_id uuid,
  peer jsonb,
  last_message jsonb,
  unread_count integer,
  my_last_read_at timestamptz,
  last_message_at timestamptz
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
    mine.last_message_at
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
  left join public.users as peer on peer.id = mine.peer_id
  left join public.designer_profiles as peer_profile on peer_profile.user_id = mine.peer_id
  order by mine.last_message_at desc;
$$;

-- ─── 9. RPC: one message page ───────────────────────────────
-- Mirrors get_community_message_page: window in DESC order (the caller
-- reverses), sender identity + grouped reactions + reply preview embedded
-- per row, so a page needs exactly one round trip. The participant guard
-- is inside the function — a non-participant gets an empty page.
create or replace function public.get_dm_message_page(
  p_conversation_id uuid,
  p_user_id uuid,
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
         and m.created_at > p_after
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
         and (p_before is null or m.created_at < p_before)
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

-- ─── 10. RPC: the badge total ───────────────────────────────
-- Messages from the peer newer than the viewer's read marker, across all
-- conversations — what the topbar DM badge shows.
create or replace function public.get_dm_unread_total(
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cnt), 0)::integer
    from (
      select (
        select count(*)
          from public.dm_messages m
         where m.conversation_id = c.id
           and m.user_id <> p_user_id
           and m.created_at > coalesce(
                 case when c.user_a = p_user_id then c.user_a_last_read_at
                      else c.user_b_last_read_at end,
                 '-infinity'::timestamptz
               )
      ) as cnt
        from public.dm_conversations c
       where c.user_a = p_user_id or c.user_b = p_user_id
    ) as per_conversation;
$$;

-- ─── 11. Grants: functions to service_role only ─────────────
revoke all on function public.get_or_create_dm_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_dm_conversation(uuid, uuid) to service_role;

revoke all on function public.get_dm_conversations(uuid) from public, anon, authenticated;
grant execute on function public.get_dm_conversations(uuid) to service_role;

revoke all on function public.get_dm_message_page(uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_dm_message_page(uuid, uuid, timestamptz, timestamptz, integer) to service_role;

revoke all on function public.get_dm_unread_total(uuid) from public, anon, authenticated;
grant execute on function public.get_dm_unread_total(uuid) to service_role;
