-- ============================================================
-- Creation limits — refundable budgets, raised caps
-- ============================================================
-- Follow-up to the 20261013/20261014 creation-limits set. Two changes:
--
--   1. THE NUMBERS. posts/day 3 (unchanged), events/month 1 -> 5,
--      jobs/month 1 -> 3, new DMs/month 5 (unchanged), own communities
--      1 -> 5, community joins 7 -> 10.
--
--   2. WHAT A DELETE DOES. The period budgets used to be append-only:
--      `bump_usage_counter` recorded every creation ever made in the
--      window, so deleting the post gave nothing back. Posts, events and
--      jobs now count LIVE rows the member created inside the same UTC
--      calendar window — delete one and the slot comes back. New-DM
--      conversations stay append-only (a conversation is not "deleted"
--      the way a post is, and the counter is the only record of who was
--      started), and own-community + join slots were already live counts.
--
-- The referee is still the database: one BEFORE INSERT trigger per family,
-- so no route, RPC or future code path can slip past it. Counting live rows
-- loses the counter row's implicit serialization, so each trigger now takes
-- a per-(kind, member) transaction advisory lock before it counts — two
-- parallel inserts cannot both read 2 and both land.
--
-- Moderation undo re-inserts a content row with its ORIGINAL id, which fires
-- these triggers again. That is not a new creation, so the triggers skip
-- enforcement for any id already recorded in `content_removals`. (Under the
-- old counter rule the same undo silently spent a budget point; now it would
-- have been refused outright once the member was at cap.)
--
-- Backfill: none needed — the count is read from the content tables at
-- insert time. The now-unused posts_daily / events_monthly / jobs_monthly
-- counter rows are deleted at the end of this file.
--
-- Idempotent: safe to re-run. This is the single file to apply.
-- ============================================================

-- ─── 1. The budgets ─────────────────────────────────────────
insert into public.creation_limits (kind, limit_count, period) values
  ('posts_daily',       3,  'day'),
  ('events_monthly',    5,  'month'),
  ('jobs_monthly',      3,  'month'),
  ('dms_monthly',       5,  'month'),
  ('communities_total', 5,  'total'),
  ('community_joins',   10, 'standing')
on conflict (kind) do update
  set limit_count = excluded.limit_count,
      period      = excluded.period;

comment on table public.creation_limits is
  'Per-member creation budgets. The numbers live here so an operator can tune them with SQL and one migration note; the database raises limit:<kind> and the app maps the kind to user-facing copy. posts_daily, events_monthly, jobs_monthly, communities_total and community_joins are counted from LIVE rows (deleting frees the slot); only dms_monthly is recorded in usage_counters. Keep community_joins in sync with JOIN_LIMIT in apps/web/lib/communities/join-slots.ts.';

-- ─── 2. Live-row counting ───────────────────────────────────
-- One window per budget family, fixed to the server's UTC calendar exactly
-- like the old counter keys: no client input reaches this.
create or replace function public.creation_window_start(p_period text)
returns timestamptz
language sql
stable
as $$
  select case p_period
    when 'day'   then date_trunc('day',   now() at time zone 'utc') at time zone 'utc'
    when 'month' then date_trunc('month', now() at time zone 'utc') at time zone 'utc'
    else '-infinity'::timestamptz
  end;
$$;

create or replace function public.count_live_creations(
  p_user_id uuid,
  p_kind    text
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
begin
  if p_user_id is null then
    return 0;
  end if;

  v_from := public.creation_window_start(
    case p_kind
      when 'posts_daily'    then 'day'
      when 'events_monthly' then 'month'
      when 'jobs_monthly'   then 'month'
      else 'total'
    end
  );

  return case p_kind
    -- "A post" is still defined in exactly one place: threads, showcase
    -- posts and resources share this budget.
    when 'posts_daily' then (
      select count(*)::integer from (
        select created_at from public.community_threads        where user_id = p_user_id
        union all
        select created_at from public.community_showcase_posts where user_id = p_user_id
        union all
        select created_at from public.community_resources      where user_id = p_user_id
      ) as posts
      where posts.created_at >= v_from
    )
    when 'events_monthly' then (
      select count(*)::integer
        from public.community_events
       where user_id = p_user_id
         and created_at >= v_from
    )
    when 'jobs_monthly' then (
      select count(*)::integer
        from public.job_posts
       where poster_id = p_user_id
         and created_at >= v_from
    )
    else 0
  end;
end;
$$;

comment on function public.count_live_creations(uuid, text) is
  'Rows the member still has alive inside the budget''s UTC window — threads + showcase + resources for posts_daily, events for events_monthly, job posts for jobs_monthly. Deleting content lowers the count, so the budget comes back.';

revoke all on function public.creation_window_start(text) from public, anon, authenticated;
grant execute on function public.creation_window_start(text) to service_role;
revoke all on function public.count_live_creations(uuid, text) from public, anon, authenticated;
grant execute on function public.count_live_creations(uuid, text) to service_role;

-- A moderation undo re-inserts the original row, id included. That insert is
-- not a creation, so it must not be refused by a budget the member has since
-- spent on other content.
create or replace function public.is_content_restore(
  p_content_type text,
  p_content_id   uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_content_id is not null and exists (
    select 1
      from public.content_removals as cr
     where cr.content_type = p_content_type
       and cr.content_id   = p_content_id
  );
$$;

comment on function public.is_content_restore(text, uuid) is
  'True when this content id has been removed by moderation before, i.e. the insert putting it back is an undo rather than a new post.';

revoke all on function public.is_content_restore(text, uuid) from public, anon, authenticated;
grant execute on function public.is_content_restore(text, uuid) to service_role;

-- ─── 3. The triggers ────────────────────────────────────────
-- Each: bypass -> undo -> lock -> count live rows -> refuse at cap. The
-- raised message stays `limit:<kind>`, so no app code has to change shape.
create or replace function public.enforce_post_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  if public.is_content_restore(
       case TG_TABLE_NAME
         when 'community_threads'         then 'thread'
         when 'community_showcase_posts'  then 'showcase'
         when 'community_resources'       then 'resource'
         else null
       end,
       new.id
     ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('creation_cap:posts_daily:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_limit
    from public.creation_limits as cl
   where cl.kind = 'posts_daily';

  if public.count_live_creations(new.user_id, 'posts_daily') >= coalesce(v_limit, 3) then
    raise exception using errcode = 'P0001', message = 'limit:posts_daily';
  end if;

  return new;
end;
$$;

comment on function public.enforce_post_creation_limit() is
  'Threads, showcase posts and resources share one daily budget — 3 posts a day across the whole app. Counted from live rows, so deleting a post frees a slot.';

create or replace function public.enforce_event_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  if public.is_content_restore('event', new.id) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('creation_cap:events_monthly:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_limit
    from public.creation_limits as cl
   where cl.kind = 'events_monthly';

  if public.count_live_creations(new.user_id, 'events_monthly') >= coalesce(v_limit, 5) then
    raise exception using errcode = 'P0001', message = 'limit:events_monthly';
  end if;

  return new;
end;
$$;

comment on function public.enforce_event_creation_limit() is
  'Up to 5 hosted events per member per UTC calendar month, in any community. Counted from live rows, so deleting an event frees a slot.';

create or replace function public.enforce_job_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('creation_cap:jobs_monthly:' || new.poster_id::text, 0)
  );

  select cl.limit_count into v_limit
    from public.creation_limits as cl
   where cl.kind = 'jobs_monthly';

  -- A closed or past-closing-date job is still a live row, so it keeps
  -- counting until it is deleted; edits never counted and still do not.
  if public.count_live_creations(new.poster_id, 'jobs_monthly') >= coalesce(v_limit, 3) then
    raise exception using errcode = 'P0001', message = 'limit:jobs_monthly';
  end if;

  return new;
end;
$$;

comment on function public.enforce_job_creation_limit() is
  'Up to 3 job posts per member per UTC calendar month. Counted from live rows: deleting a post frees a slot, closing one does not.';

-- ─── 4. The two standing caps (numbers only) ────────────────
create or replace function public.enforce_membership_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type  text;
  v_cap   integer;
  v_count integer;
begin
  if public.creation_limits_bypassed() then
    return new;
  end if;

  select c.type into v_type
    from public.communities as c
   where c.id = new.community_id;

  -- Event group chats are excluded: hosting creates one and RSVPing joins
  -- one, so counting them would let an event break its own host. Unknown
  -- community ids (v_type is null) fall through to the FK error below.
  if v_type is null or v_type = 'event' then
    return new;
  end if;

  -- A duplicate insert — the idempotent re-join/upsert paths — lands on an
  -- existing pair and must not consume a slot or trip the cap.
  if exists (
    select 1
      from public.community_members as m
     where m.community_id = new.community_id
       and m.user_id = new.user_id
  ) then
    return new;
  end if;

  -- Serialize per member so two parallel joins cannot both read nine and
  -- both land; release at commit. Leaving frees a slot — the count is of
  -- live rows.
  perform pg_advisory_xact_lock(
    hashtextextended('community_join_cap:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_cap
    from public.creation_limits as cl
   where cl.kind = 'community_joins';

  v_count := public.count_join_slots(new.user_id);

  if v_count >= coalesce(v_cap, 10) then
    raise exception using errcode = 'P0001', message = 'limit:community_joins';
  end if;

  return new;
end;
$$;

comment on function public.enforce_membership_cap() is
  'Standing cap of 10 live communities per member (event rooms excluded, deactivated and ownerless rooms not charged), with a per-member advisory lock against parallel joins.';

create or replace function public.enforce_community_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap      integer;
  v_join_cap integer;
  v_count    integer;
begin
  -- Only member-created communities count. Official groups (city, sector,
  -- experience level, job title) are system-created on demand, and event
  -- group chats are created by the event flow (see ensureEventChatCommunity)
  -- — counting those would spend a member's own-community budget on
  -- infrastructure.
  if new.type <> 'user' or new.owner_id is null or public.creation_limits_bypassed() then
    return new;
  end if;

  -- Serialize per owner: two parallel creates must not both read zero.
  perform pg_advisory_xact_lock(
    hashtextextended('community_create_cap:' || new.owner_id::text, 0)
  );

  -- Rule 1 — up to five LIVE communities of your own, counted the way the
  -- sidebar counts: active, with the owner still inside it. Deleting the
  -- community (the soft delete behind the app's Delete button) drops it out
  -- of this count and hands the budget back.
  select cl.limit_count into v_cap
    from public.creation_limits as cl
   where cl.kind = 'communities_total';

  select count(*) into v_count
    from public.communities as c
   where c.owner_id = new.owner_id
     and c.type = 'user'
     and c.is_active
     and exists (
       select 1
         from public.community_members as m
        where m.community_id = c.id
          and m.user_id = c.owner_id
     );

  if v_count >= coalesce(v_cap, 5) then
    raise exception using errcode = 'P0001', message = 'limit:communities_total';
  end if;

  -- Rule 2 — the creator joins their own community, so a creation needs a
  -- free join slot exactly like any other join: a member already in ten live
  -- communities cannot create on top of that.
  select cl.limit_count into v_join_cap
    from public.creation_limits as cl
   where cl.kind = 'community_joins';

  if public.count_join_slots(new.owner_id) >= coalesce(v_join_cap, 10) then
    raise exception using errcode = 'P0001', message = 'limit:community_joins';
  end if;

  return new;
end;
$$;

comment on function public.enforce_community_creation_limit() is
  'Up to 5 member-created communities per member, counted live: deleting one returns the budget. Creating also needs a free join slot.';

-- ─── 5. Retire the counters that are no longer the referee ──
delete from public.usage_counters
 where kind in ('posts_daily', 'events_monthly', 'jobs_monthly');

comment on table public.usage_counters is
  'Append-only usage records for the budgets that stay append-only — dms_monthly only, since posts/events/jobs are now counted from live rows.';
