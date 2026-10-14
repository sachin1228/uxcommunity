-- ============================================================
-- Direct messages — message requests, blocking and reports.
--
-- Three features on top of the DM core (20261012100000 / 20261012120000):
--
--   1. MESSAGE REQUESTS. A conversation the app starts (get_or_create) begins
--      `pending`; the first message's author becomes its requester
--      (`requested_by`). Until the other participant accepts, the requester
--      may hold exactly ONE message — enforced by the insert trigger, so even
--      a racing double-send cannot slip a second one in. A message from the
--      OTHER participant is an implicit acceptance; the explicit accept /
--      reject endpoints are the client's way to say the same. `rejected`
--      closes the conversation for both writers. Conversations that predate
--      this file default to `accepted`, so nothing already in flight changes
--      behaviour.
--
--   2. BLOCKING (`dm_blocks`, one row per (blocker, blocked) pair). The
--      blocker stops seeing the conversation (the list and unread RPCs filter
--      it out) and no NEW message can be inserted into a blocked pair — the
--      guard raises for both directions, so the blocked member's composer
--      fails server-side instead of silently writing rows nobody reads.
--
--   3. REPORTS (`dm_reports`). The reporter is recorded; the reported member
--      and a snapshot of the conversation's recent messages are stored so the
--      admin queue still reads after the chat is gone. Reviewed from
--      /admin/dm-reports through the `dm_report_queue` view.
-- ============================================================

-- ─── 1. Conversation request state ──────────────────────────
-- `accepted` default: rows that predate the request flow (and direct
-- service-role inserts) stay ordinary chats; only conversations created by
-- the app's own get_or_create start `pending`.
alter table public.dm_conversations
  add column if not exists request_state text not null default 'accepted'
    check (request_state in ('pending', 'accepted', 'rejected')),
  add column if not exists requested_by uuid references public.users (id) on delete set null;

comment on column public.dm_conversations.request_state is
  'Request lifecycle: pending (first message awaits the recipient''s answer) / accepted / rejected. Pre-request-flow rows are accepted.';
comment on column public.dm_conversations.requested_by is
  'Author of the pending request''s first message — the one-sided sender. Null until the first message lands.';

-- ─── 2. Blocks ──────────────────────────────────────────────
create table if not exists public.dm_blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint dm_blocks_no_self check (blocker_id <> blocked_id),
  constraint dm_blocks_pair_unique unique (blocker_id, blocked_id)
);

comment on table public.dm_blocks is
  'Member-to-member DM blocks. The blocker stops seeing the conversation and neither side can send into it while the row exists.';

-- The reverse direction ("has the peer blocked me") reads by blocked_id.
create index if not exists idx_dm_blocks_blocked
  on public.dm_blocks (blocked_id);

alter table public.dm_blocks enable row level security;
revoke all on table public.dm_blocks from anon, authenticated;

-- ─── 3. Reports ─────────────────────────────────────────────
create table if not exists public.dm_reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.users (id) on delete cascade,
  -- Nulled when the member closes their account; the report itself survives.
  reported_user_id  uuid references public.users (id) on delete set null,
  conversation_id   uuid references public.dm_conversations (id) on delete set null,
  reason            text not null check (
    reason in (
      'spam',
      'harassment',
      'hate',
      'misinformation',
      'inappropriate',
      'intellectual_property',
      'off_topic',
      'other'
    )
  ),
  details           text,
  -- [{ id, user_id, author_name, content, image_url, created_at }] — the last
  -- messages of the conversation at report time, so the admin queue is
  -- self-contained (and stays readable after the chat is deleted).
  message_snapshot  jsonb not null default '[]'::jsonb,
  status            text not null default 'pending' check (
    status in ('pending', 'reviewed', 'dismissed')
  ),
  resolved_at       timestamptz,
  resolved_by       uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_dm_reports_status_created
  on public.dm_reports (status, created_at desc);

-- One open report per member per reported user: a second submission while
-- the first is still pending is rejected; resolved reports can be re-filed.
create unique index if not exists dm_reports_pending_unique
  on public.dm_reports (reporter_id, reported_user_id)
  where status = 'pending';

alter table public.dm_reports enable row level security;
revoke all on table public.dm_reports from anon, authenticated;

-- ─── 4. Admin queue view ────────────────────────────────────
-- Names resolved for the queue; the snapshot rides along so the page needs
-- no second round trip.
create or replace view public.dm_report_queue as
select
  r.id,
  r.reporter_id,
  reporter.name            as reporter_name,
  r.reported_user_id,
  reported.name            as reported_user_name,
  r.conversation_id,
  r.reason,
  r.details,
  r.message_snapshot,
  r.status,
  r.resolved_at,
  r.created_at
from public.dm_reports r
left join public.users reporter on reporter.id = r.reporter_id
left join public.users reported on reported.id = r.reported_user_id;

revoke all on public.dm_report_queue from anon, authenticated;
grant select on public.dm_report_queue to service_role;

-- ─── 5. Message guard: blocks + the request state machine ───
-- Replaces the hardening version (same name + trigger). New checks, all on
-- INSERT only — updates (edits, soft-deletes of old rows) stay allowed:
--   * a blocked pair accepts no new message from either direction;
--   * a rejected conversation accepts none;
--   * while pending, the requester holds exactly one message;
--   * the first message of a pending conversation defines the requester;
--   * the OTHER participant's message is an implicit acceptance.
-- The conversation row is locked first, so concurrent sends serialize on it
-- and every branch below reads one consistent state.
create or replace function public.dm_message_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conv public.dm_conversations%rowtype;
begin
  select * into conv
    from public.dm_conversations c
   where c.id = new.conversation_id
   for update;

  if not found then
    raise exception 'Conversation does not exist' using errcode = '23503';
  end if;

  if new.user_id <> conv.user_a and new.user_id <> conv.user_b then
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

  if tg_op = 'INSERT' then
    if exists (
      select 1
        from public.dm_blocks b
       where (b.blocker_id = conv.user_a and b.blocked_id = conv.user_b)
          or (b.blocker_id = conv.user_b and b.blocked_id = conv.user_a)
    ) then
      raise exception 'Blocked conversations cannot receive messages'
        using errcode = '23514';
    end if;

    if conv.request_state = 'rejected' then
      raise exception 'Message request was declined' using errcode = '23514';
    end if;

    if conv.request_state = 'pending' then
      if conv.requested_by is null then
        -- The first message makes its author the requester.
        update public.dm_conversations
           set requested_by = new.user_id
         where id = conv.id;
      elsif conv.requested_by = new.user_id then
        if exists (
          select 1
            from public.dm_messages m
           where m.conversation_id = conv.id
             and m.user_id = new.user_id
        ) then
          raise exception 'One message until the request is accepted'
            using errcode = '23514';
        end if;
      else
        -- A reply from the other participant IS the acceptance.
        update public.dm_conversations
           set request_state = 'accepted'
         where id = conv.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.dm_message_guard() from public, anon, authenticated;

-- ─── 6. get_or_create: reap the request state ───────────────
-- The OUT shape grows two columns, so the old signature is dropped first.
-- New conversations start `pending` (the request flow); the creation-limit
-- bump from 20261013120000 is preserved verbatim.
drop function if exists public.get_or_create_dm_conversation(uuid, uuid);

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
  my_last_read_at timestamptz,
  request_state text,
  requested_by uuid
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
  v_existing uuid;
begin
  if p_me = p_peer then
    raise exception 'Cannot start a conversation with yourself' using errcode = '22023';
  end if;

  select c.id into v_existing
    from public.dm_conversations as c
   where c.user_a = pair_a
     and c.user_b = pair_b;

  if v_existing is null then
    insert into public.dm_conversations (user_a, user_b, request_state)
    values (pair_a, pair_b, 'pending')
    on conflict (user_a, user_b) do nothing;

    -- The row was genuinely created (not raced onto an existing pair), so
    -- this counts as one of the starter's new conversations this month. The
    -- counter refuses past the cap and rolls the insert back with it; two
    -- parallel creates serialize on the counter row, so the cap holds even
    -- under a burst (see the creation-limits migration).
    if found then
      perform public.bump_usage_counter(p_me, 'dms_monthly');
    end if;
  end if;

  return query
    select c.id, c.user_a, c.user_b, c.created_at, c.last_message_at,
           case when c.user_a = p_me then c.user_a_last_read_at
                else c.user_b_last_read_at end,
           c.request_state,
           c.requested_by
      from public.dm_conversations c
     where c.user_a = pair_a
       and c.user_b = pair_b;
end;
$$;

revoke all on function public.get_or_create_dm_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_dm_conversation(uuid, uuid) to service_role;

-- ─── 7. Conversation list: request state + block/reject filters ─
-- Adds request_state/requested_by to the payload (the list row and the open
-- thread read them) and drops conversations the viewer should not see:
--   * a rejected request is gone for BOTH sides;
--   * a conversation with someone the viewer blocked is gone for the blocker.
-- The blocked member keeps seeing the conversation (history is theirs), but
-- nothing new can arrive — the guard above refuses the inserts.
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
  last_reaction jsonb,
  request_state text,
  requested_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select c.id,
           c.last_message_at,
           c.request_state,
           c.requested_by,
           case when c.user_a = p_user_id then c.user_b else c.user_a end as peer_id,
           case when c.user_a = p_user_id then c.user_a_last_read_at
                else c.user_b_last_read_at end as my_last_read_at
      from public.dm_conversations c
     where (c.user_a = p_user_id or c.user_b = p_user_id)
       and c.last_message_at is not null
       and c.request_state <> 'rejected'
       and not exists (
         select 1
           from public.dm_blocks b
          where b.blocker_id = p_user_id
            and b.blocked_id = (case when c.user_a = p_user_id then c.user_b else c.user_a end)
       )
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
    end as last_reaction,
    mine.request_state,
    mine.requested_by
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
  'DM conversation list: peer identity, last-message preview, viewer unread count, newest reaction event and the request state; rejected conversations and the viewer''s blocked peers are omitted.';

revoke all on function public.get_dm_conversations(uuid) from public, anon, authenticated;
grant execute on function public.get_dm_conversations(uuid) to service_role;

-- ─── 8. Unread badge: same two filters ──────────────────────
-- A rejected request nags nobody; a blocked peer's conversation does not
-- count for the blocker.
create or replace function public.get_dm_unread_total(
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.dm_conversations c
   where (c.user_a = p_user_id or c.user_b = p_user_id)
     and c.request_state <> 'rejected'
     and not exists (
       select 1
         from public.dm_blocks b
        where b.blocker_id = p_user_id
          and b.blocked_id = (case when c.user_a = p_user_id then c.user_b else c.user_a end)
     )
     and exists (
       select 1
         from public.dm_messages m
        where m.conversation_id = c.id
          and m.user_id <> p_user_id
          and m.created_at > coalesce(
                case when c.user_a = p_user_id then c.user_a_last_read_at
                     else c.user_b_last_read_at end,
                '-infinity'::timestamptz
              )
     );
$$;

revoke all on function public.get_dm_unread_total(uuid) from public, anon, authenticated;
grant execute on function public.get_dm_unread_total(uuid) to service_role;

notify pgrst, 'reload schema';
