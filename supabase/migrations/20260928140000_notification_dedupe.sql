-- ============================================================
-- M-4 — Notification deduplication is enforced by the database
--
-- THE BUG
-- createNotification() (apps/web/lib/notifications.ts) decided between a new
-- notification and an aggregated update with two separate round trips:
--
--     select id, metadata from notifications
--     where user_id = ? and entity_type = ? and entity_id = ? and read_at is null
--     -- if a row came back -> UPDATE (bump metadata.count, keep one row)
--     -- otherwise        -> INSERT
--
-- Two callers that race — two people commenting / liking / RSVPing to the same
-- recipient's content at the same time, each running in its own deferred
-- after() callback, possibly in different Worker isolates — can both run the
-- SELECT before either INSERT commits, both see "no row", and both INSERT.
-- The result is two unread notification rows for one logical notification: a
-- duplicated bell entry and a double-counted unread badge.
--
-- THE FIX
-- The logical identity of an unread notification is exactly the row the old
-- lookup selected:
--
--     (user_id, entity_type, entity_id)      while read_at is null
--
-- The recipient, the entity and the unread state define "the same
-- notification"; a different actor, type, title or timestamp is a newer EVENT
-- on that same notification and is aggregated into it (metadata.count), which
-- is the product behaviour the old UPDATE branch implemented. read_at is
-- deliberately part of the identity: once a notification is read, a later
-- event is a NEW notification and is allowed to insert again.
--
-- A partial UNIQUE index on that key makes the identity a database fact, and
-- create_notification() performs the insert-or-aggregate as one atomic
-- operation, so a racing caller can no longer insert a second row: it either
-- inserts first (inserted = true) or hits the unique row and aggregates into
-- it (inserted = false). Application code no longer runs the check.
--
-- This file:
--   1. merges duplicates the race already produced,
--   2. replaces the non-unique dedupe index with a UNIQUE partial index,
--   3. adds the atomic create_notification() RPC the app now calls.
-- ============================================================


-- ─── 1. Existing duplicates ─────────────────────────────────────────────────
-- Production data may already contain the duplicates this race creates. They
-- are not silently discarded: for each (user_id, entity_type, entity_id) group
-- of unread rows, the newest row (the one the notification list already shows
-- at the top) survives and its metadata.count absorbs the events every
-- duplicate stood for; the older rows are then removed. Rows with a unique key
-- are never touched, and read notifications are outside the index's scope so
-- they are left exactly as they are.
--
-- The same query shape is the duplicate audit: running it on its own reports
-- how many groups are affected and how many rows would be removed.

with ranked as (
  select
    id,
    user_id,
    entity_type,
    entity_id,
    row_number() over (
      partition by user_id, entity_type, entity_id
      order by created_at desc, id desc
    ) as dup_rank,
    coalesce(nullif(metadata ->> 'count', '')::int, 1) as events
  from public.notifications
  where read_at is null
),
merged as (
  select
    user_id,
    entity_type,
    entity_id,
    sum(events) as total_events
  from ranked
  group by user_id, entity_type, entity_id
  having count(*) > 1
)
update public.notifications as n
set metadata = n.metadata || jsonb_build_object('count', merged.total_events)
from merged, ranked
where ranked.id = n.id
  and ranked.dup_rank = 1
  and ranked.user_id = merged.user_id
  and ranked.entity_type = merged.entity_type
  and ranked.entity_id = merged.entity_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, entity_type, entity_id
      order by created_at desc, id desc
    ) as dup_rank
  from public.notifications
  where read_at is null
)
delete from public.notifications as n
using ranked
where n.id = ranked.id
  and ranked.dup_rank > 1;


-- ─── 2. The uniqueness that closes the race ─────────────────────────────────
-- The old non-unique index supported the dedupe lookup. A unique index on the
-- same columns and predicate both supports that lookup and makes the identity
-- real, so it REPLACES the old one rather than sitting beside it (a second
-- index on identical columns would only add write cost).
--
-- Migrations run inside a transaction on Supabase, so this is a regular (not
-- CONCURRENTLY) build: it takes a write lock on notifications for the duration
-- of the build, matching every other index migration in this repository.
drop index if exists public.idx_notifications_user_entity_unread;
create unique index if not exists idx_notifications_user_entity_unread
  on public.notifications (user_id, entity_type, entity_id)
  where read_at is null;


-- ─── 3. Atomic insert-or-aggregate ──────────────────────────────────────────
-- Service-role only, like the other route-authorized RPCs: the API route is the
-- authorization boundary and the app calls this with the service-role client.
--
-- `inserted` distinguishes the two outcomes for the caller's realtime publish.
-- A conflict must NOT be reported as a new notification, otherwise the client
-- would prepend a row it already has and increment the unread badge twice.
create or replace function public.create_notification(
  p_user_id uuid,
  p_actor_id uuid,
  p_community_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_body text,
  p_href text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  user_id uuid,
  actor_id uuid,
  community_id uuid,
  type text,
  entity_type text,
  entity_id uuid,
  title text,
  body text,
  href text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz,
  inserted boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
-- The ON CONFLICT target names columns that are also OUT parameters of this
-- RETURNS TABLE; resolve those identifiers to the table columns, not the
-- variables (the variables are used explicitly as v_row / p_* elsewhere).
#variable_conflict use_column
declare
  v_row public.notifications;
  v_inserted boolean := false;
  v_attempt integer;
begin
  -- The INSERT is the authority. If a concurrent caller already inserted the
  -- unread row, this one conflicts and does nothing; the UPDATE then aggregates
  -- into whatever row won (READ COMMITTED re-reads it after the insert wait).
  for v_attempt in 1..3 loop
    insert into public.notifications
      (user_id, actor_id, community_id, type, entity_type, entity_id,
       title, body, href, metadata)
    values
      (p_user_id, p_actor_id, p_community_id, p_type, p_entity_type, p_entity_id,
       p_title, p_body, p_href, coalesce(p_metadata, '{}'::jsonb))
    on conflict (user_id, entity_type, entity_id) where read_at is null
    do nothing
    returning * into v_row;

    if v_row.id is not null then
      v_inserted := true;
      exit;
    end if;

    -- The unread row already existed, so this event aggregates into it: the
    -- latest event's payload wins and metadata.count records how many events
    -- the single row stands for (same fields, same order, same timestamp bump
    -- as the old application UPDATE).
    update public.notifications as n
    set actor_id     = p_actor_id,
        community_id = p_community_id,
        type         = p_type,
        title        = p_title,
        body         = p_body,
        href         = p_href,
        metadata     = n.metadata
                       || jsonb_build_object(
                            'count',
                            coalesce(nullif(n.metadata ->> 'count', '')::int, 1) + 1
                          ),
        created_at   = now()
    where n.user_id = p_user_id
      and n.entity_type = p_entity_type
      and n.entity_id = p_entity_id
      and n.read_at is null
    returning * into v_row;

    if v_row.id is not null then
      exit;
    end if;
  end loop;

  -- The unread row can be read (or deleted) between the two statements above.
  -- When that happens there is nothing left to aggregate into, so this becomes
  -- a fresh notification; the unique index still guarantees at most one.
  if v_row.id is null then
    insert into public.notifications
      (user_id, actor_id, community_id, type, entity_type, entity_id,
       title, body, href, metadata)
    values
      (p_user_id, p_actor_id, p_community_id, p_type, p_entity_type, p_entity_id,
       p_title, p_body, p_href, coalesce(p_metadata, '{}'::jsonb))
    on conflict (user_id, entity_type, entity_id) where read_at is null
    do nothing
    returning * into v_row;

    if v_row.id is not null then
      v_inserted := true;
    end if;
  end if;

  return query
  select
    v_row.id, v_row.user_id, v_row.actor_id, v_row.community_id, v_row.type,
    v_row.entity_type, v_row.entity_id, v_row.title::text, v_row.body, v_row.href,
    v_row.metadata, v_row.read_at, v_row.created_at, v_inserted;
end;
$$;

comment on function public.create_notification(uuid, uuid, uuid, text, text, uuid, text, text, text, jsonb) is
  'M-4: inserts one unread notification per (user_id, entity_type, entity_id), or atomically aggregates a repeat event into the existing unread row. Returns inserted = true only when a new row was created, so callers publish the right realtime event.';

revoke all on function public.create_notification(uuid, uuid, uuid, text, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_notification(uuid, uuid, uuid, text, text, uuid, text, text, text, jsonb)
  to service_role;
