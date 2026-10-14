-- ============================================================
-- Creation limits — per-member budgets, enforced in the database
-- ============================================================
-- The rules, all keyed to the member who creates:
--
--   posts_daily        3    community threads + showcase posts share
--                           one budget, per UTC calendar day
--   events_monthly     1    events hosted, per UTC calendar month
--   jobs_monthly       1    job posts, per UTC calendar month
--   dms_monthly        5    NEW direct conversations started, per UTC
--                           calendar month (replying in an existing
--                           conversation is never capped)
--   communities_total  1    member-created communities, lifetime
--   community_joins    7    standing memberships; leaving frees a slot;
--                           event group chats are excluded (joining one
--                           is an RSVP side effect, not a "join")
--
-- Why the database and not the routes:
--   every read/write already goes through the service-role client, but
--   the members themselves reach the app through the Next.js routes —
--   and there are many of them (threads, showcase, events, three join
--   entry points, job RPC, DM RPC, profile-identity swap, auto-join).
--   A check per route would be one forgotten call away from a bypass.
--   A trigger is one referee for every path, present and future.
--
-- How the budgets hold under attack:
--   * Period budgets go through `bump_usage_counter`: a single atomic
--     upsert that increments and refuses in one statement. Two parallel
--     creates serialize on the counter row, so a burst of concurrent
--     requests cannot overshoot a limit the way check-then-insert can.
--     The refusal raise rolls the increment back with the business row.
--   * Counters only ever go up. Deleting the post/event/job/community
--     does NOT refund the budget — delete-then-repost churn is exactly
--     the bypass this closes (all four have delete paths in the app).
--   * The standing join cap counts live membership rows instead (that
--     is what makes leaving refund a slot) under a per-member advisory
--     lock, so two parallel joins cannot both read six.
--   * Windows are fixed to UTC on the server clock (see v_key below) —
--     no client-supplied timezone can widen them.
--   * The API message is machine-stable: the exception message is
--     `limit:<kind>` and carries no prose; the app maps the kind to
--     copy (apps/web/lib/creation-limits.ts), so wording lives in one
--     place on each side.
--
-- The deliberate escape hatch:
--   `app.bypass_creation_limits` = 'on' (set transaction-locally) skips
--   both the counters and the join cap. Only two things set it: the
--   admin join-all RPC below (operator action) and SQL test fixtures
--   while seeding (session-local). Every table here is service-role
--   only, so nothing user-reachable can turn it on.
--
-- Seeds in this migration backfill the counters from the rows that
-- already exist so the budgets are fair on the day they ship. The DM
-- counter is the one exception: who *started* an existing conversation
-- is not recorded on the row, so counting pairs would punish receivers
-- — DM counting starts at zero with a one-month grace instead.
-- ============================================================

-- ─── 1. The budget table ────────────────────────────────────
create table if not exists public.creation_limits (
  kind        text primary key,
  limit_count integer not null check (limit_count > 0),
  -- 'day' | 'month' reset on the UTC calendar; 'total' never resets;
  -- 'standing' budgets are counted from live rows, not from usage_counters.
  period      text not null check (period in ('day', 'month', 'total', 'standing'))
);

insert into public.creation_limits (kind, limit_count, period) values
  ('posts_daily',       3, 'day'),
  ('events_monthly',    1, 'month'),
  ('jobs_monthly',      1, 'month'),
  ('dms_monthly',       5, 'month'),
  ('communities_total', 1, 'total'),
  ('community_joins',   7, 'standing')
on conflict (kind) do nothing;

comment on table public.creation_limits is
  'Per-member creation budgets. The numbers live here so an operator can tune them with SQL and one migration note; the database raises limit:<kind> and the app maps the kind to user-facing copy. Keep community_joins in sync with JOIN_LIMIT in apps/web/lib/communities/join-slots.ts.';

alter table public.creation_limits enable row level security;
revoke all on table public.creation_limits from anon, authenticated;

-- ─── 2. The counter table ───────────────────────────────────
create table if not exists public.usage_counters (
  user_id    uuid not null references public.users (id) on delete cascade,
  kind       text not null references public.creation_limits (kind),
  -- 'YYYY-MM-DD' for day budgets, 'YYYY-MM' for month budgets, 'total' otherwise.
  period_key text not null,
  count      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);

comment on table public.usage_counters is
  'Append-only creation counters — only ever bumped, never refunded, so deleting the created row cannot restore the budget.';

alter table public.usage_counters enable row level security;
revoke all on table public.usage_counters from anon, authenticated;

-- ─── 3. The helpers ─────────────────────────────────────────
create or replace function public.creation_limits_bypassed()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.bypass_creation_limits', true), '') = 'on';
$$;

comment on function public.creation_limits_bypassed() is
  'True while the session/transaction carries app.bypass_creation_limits = on (admin RPCs and SQL test fixtures only).';

create or replace function public.bump_usage_counter(
  p_user_id uuid,
  p_kind    text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit  integer;
  v_period text;
  v_key    text;
  v_count  integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  select cl.limit_count, cl.period
    into v_limit, v_period
    from public.creation_limits as cl
   where cl.kind = p_kind;

  if v_limit is null then
    raise exception using errcode = '22023', message = 'unknown_limit:' || p_kind;
  end if;

  -- Fixed to the server's UTC calendar: no client input reaches this.
  v_key := case v_period
    when 'day'   then to_char((now() at time zone 'utc'), 'YYYY-MM-DD')
    when 'month' then to_char((now() at time zone 'utc'), 'YYYY-MM')
    when 'total' then 'total'
    else null
  end;

  if v_key is null then
    -- 'standing' budgets are counted from live rows (membership trigger);
    -- they must never be bumped.
    raise exception using errcode = '22023', message = 'counter_not_bumpable:' || p_kind;
  end if;

  -- One statement — the row lock serializes concurrent bumps, so each
  -- caller sees a count that includes every other caller's bump.
  insert into public.usage_counters as uc (user_id, kind, period_key, count, updated_at)
  values (p_user_id, p_kind, v_key, 1, now())
  on conflict (user_id, kind, period_key) do update
    set count      = uc.count + 1,
        updated_at = now()
  returning uc.count into v_count;

  if v_count > v_limit then
    raise exception using errcode = 'P0001', message = 'limit:' || p_kind;
  end if;

  return v_count;
end;
$$;

comment on function public.bump_usage_counter(uuid, text) is
  'Atomic bump-and-check for a period budget; past the cap raises P0001 with message limit:<kind>, rolling the bump back with the caller''s transaction.';

revoke all on function public.creation_limits_bypassed() from public, anon, authenticated;
grant execute on function public.creation_limits_bypassed() to service_role;
revoke all on function public.bump_usage_counter(uuid, text) from public, anon, authenticated;
grant execute on function public.bump_usage_counter(uuid, text) to service_role;

-- ─── 4. Enforcement triggers ────────────────────────────────
-- One function per budget family; the trigger fires on every insert no
-- matter which route, RPC or future code path performs it.

create or replace function public.enforce_post_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.creation_limits_bypassed() then
    perform public.bump_usage_counter(new.user_id, 'posts_daily');
  end if;
  return new;
end;
$$;

comment on function public.enforce_post_creation_limit() is
  'Threads and showcase posts share one daily budget — 3 posts a day across the whole app.';

create or replace function public.enforce_event_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.creation_limits_bypassed() then
    perform public.bump_usage_counter(new.user_id, 'events_monthly');
  end if;
  return new;
end;
$$;

comment on function public.enforce_event_creation_limit() is
  'One hosted event per member per UTC calendar month, in any community.';

create or replace function public.enforce_job_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.creation_limits_bypassed() then
    perform public.bump_usage_counter(new.poster_id, 'jobs_monthly');
  end if;
  return new;
end;
$$;

comment on function public.enforce_job_creation_limit() is
  'One job post per member per UTC calendar month; edits of an existing post do not count.';

create or replace function public.enforce_community_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only member-created communities count. Official groups (city, sector,
  -- experience level, job title) are system-created on demand, and event
  -- group chats are created by the event flow (see ensureEventChatCommunity)
  -- — counting those would spend a member's one community on infrastructure.
  if new.type = 'user'
     and new.owner_id is not null
     and not public.creation_limits_bypassed() then
    perform public.bump_usage_counter(new.owner_id, 'communities_total');
  end if;
  return new;
end;
$$;

comment on function public.enforce_community_creation_limit() is
  'One member-created community per member, lifetime: deleting it does not refund the slot, which is what stops create-delete churn.';

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

  -- Serialize per member so two parallel joins cannot both read six and
  -- both land; release at commit. Leaving frees a slot — the count is of
  -- live rows.
  perform pg_advisory_xact_lock(
    hashtextextended('community_join_cap:' || new.user_id::text, 0)
  );

  select cl.limit_count into v_cap
    from public.creation_limits as cl
   where cl.kind = 'community_joins';

  select count(*) into v_count
    from public.community_members as m
    join public.communities as c2 on c2.id = m.community_id
   where m.user_id = new.user_id
     and c2.type <> 'event';

  if v_count >= coalesce(v_cap, 7) then
    raise exception using errcode = 'P0001', message = 'limit:community_joins';
  end if;

  return new;
end;
$$;

comment on function public.enforce_membership_cap() is
  'Standing cap of 7 real communities per member (event rooms excluded), with a per-member advisory lock against parallel joins.';

drop trigger if exists trg_community_threads_creation_limit on public.community_threads;
create trigger trg_community_threads_creation_limit
  before insert on public.community_threads
  for each row execute function public.enforce_post_creation_limit();

drop trigger if exists trg_community_showcase_creation_limit on public.community_showcase_posts;
create trigger trg_community_showcase_creation_limit
  before insert on public.community_showcase_posts
  for each row execute function public.enforce_post_creation_limit();

drop trigger if exists trg_community_events_creation_limit on public.community_events;
create trigger trg_community_events_creation_limit
  before insert on public.community_events
  for each row execute function public.enforce_event_creation_limit();

drop trigger if exists trg_job_posts_creation_limit on public.job_posts;
create trigger trg_job_posts_creation_limit
  before insert on public.job_posts
  for each row execute function public.enforce_job_creation_limit();

drop trigger if exists trg_communities_creation_limit on public.communities;
create trigger trg_communities_creation_limit
  before insert on public.communities
  for each row execute function public.enforce_community_creation_limit();

drop trigger if exists trg_community_members_join_cap on public.community_members;
create trigger trg_community_members_join_cap
  before insert on public.community_members
  for each row execute function public.enforce_membership_cap();

-- ─── 5. Cap-aware official-group swap (update_profile_identity) ──
create or replace function public.update_profile_identity(
  p_user_id uuid,
  p_name text default null,
  p_city_id uuid default null,
  p_sector_id uuid default null,
  p_experience_level text default null,
  p_job_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_city_id uuid;
  v_sector_id uuid;
  v_experience_level text;
  v_job_title text;
  v_new_name text;
  v_experience_changed boolean := false;
  v_job_title_changed boolean := false;
  v_city_changed boolean := false;
  v_sector_changed boolean := false;
  v_changed text[] := array[]::text[];
  v_locked jsonb;
  v_left jsonb := '[]'::jsonb;
  v_joined jsonb := '[]'::jsonb;
  v_move record;
  v_group record;
  v_community_id uuid;
  v_community_name text;
  v_community_image text;
  v_upserted integer;
  v_member_count integer;
  v_join_cap integer;
begin
  -- ── Lock the member's rows so two edits cannot interleave ──
  select u.name
    into v_name
    from public.users as u
   where u.id = p_user_id
   for update;

  select dp.city_id, dp.sector_id, dp.experience_level::text, dp.job_title
    into v_city_id, v_sector_id, v_experience_level, v_job_title
    from public.designer_profiles as dp
   where dp.user_id = p_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  -- ── What actually changed (a null parameter leaves that slot as is) ──
  if p_name is not null then
    v_new_name := btrim(p_name);
    if v_new_name = '' then
      raise exception using errcode = '22023', message = 'invalid_name';
    end if;
    if v_new_name is distinct from v_name then
      v_changed := array_append(v_changed, 'name');
    else
      v_new_name := null;
    end if;
  end if;

  if p_city_id is not null and p_city_id is distinct from v_city_id then
    v_city_changed := true;
    v_changed := array_append(v_changed, 'city');
  end if;

  if p_sector_id is not null and p_sector_id is distinct from v_sector_id then
    v_sector_changed := true;
    v_changed := array_append(v_changed, 'sector');
  end if;

  -- Experience level and job title are separate slots — separate fields in
  -- signup and in the modal — so each carries its own three-month cooldown.
  v_experience_changed :=
    p_experience_level is not null and p_experience_level is distinct from v_experience_level;
  v_job_title_changed :=
    p_job_title is not null and p_job_title is distinct from v_job_title;

  if v_experience_changed then
    v_changed := array_append(v_changed, 'experience_level');
  end if;

  if v_job_title_changed then
    v_changed := array_append(v_changed, 'job_title');
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object(
      'changed_fields', '[]'::jsonb,
      'left_communities', v_left,
      'joined_communities', v_joined
    );
  end if;

  -- ── Cooldown gate: lock the records, then refuse slots changed < 3 months ago ──
  perform 1
    from public.profile_field_changes as pfc
   where pfc.user_id = p_user_id
     and pfc.field = any (v_changed)
   for update;

  select jsonb_object_agg(locked.field, to_jsonb(locked.available_at))
    into v_locked
    from (
      select pfc.field,
             pfc.changed_at + interval '3 months' as available_at
        from public.profile_field_changes as pfc
       where pfc.user_id = p_user_id
         and pfc.field = any (v_changed)
         and pfc.changed_at > now() - interval '3 months'
    ) as locked;

  if v_locked is not null then
    raise exception using
      errcode = 'P0001',
      message = 'profile_field_cooldown',
      detail  = v_locked::text;
  end if;

  -- ── Every new value must exist in master data and be active ──
  if v_city_changed and not exists (
    select 1 from public.cities as c where c.id = p_city_id and c.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if v_sector_changed and not exists (
    select 1 from public.design_sectors as s where s.id = p_sector_id and s.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if v_experience_changed and not exists (
    select 1 from public.experience_levels as e
     where e.slug = p_experience_level and e.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if v_job_title_changed and not exists (
    select 1 from public.job_titles as j
     where j.slug = p_job_title and j.is_active
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  -- ── Apply the updates ──
  if 'name' = any (v_changed) then
    update public.users set name = v_new_name where id = p_user_id;
  end if;

  update public.designer_profiles as dp
     set city_id          = case when v_city_changed then p_city_id else dp.city_id end,
         sector_id        = case when v_sector_changed then p_sector_id else dp.sector_id end,
         experience_level = case when v_experience_changed then p_experience_level else dp.experience_level end,
         job_title        = case when v_job_title_changed then p_job_title else dp.job_title end
   where dp.user_id = p_user_id;

  -- ── Record the change timestamps ──
  -- The ON CONFLICT ... WHERE re-runs the cooldown test inside the write, so
  -- two concurrent edits still cannot both consume a fresh slot: the loser
  -- inserts/updates no row and the count check below raises.
  with upserted as (
    insert into public.profile_field_changes as pfc (user_id, field, changed_at)
    select p_user_id, slot.field, now()
      from unnest(v_changed) as slot(field)
    on conflict (user_id, field) do update
      set changed_at = excluded.changed_at
      where pfc.changed_at <= now() - interval '3 months'
    returning pfc.field
  )
  select count(*) into v_upserted from upserted;

  if v_upserted <> coalesce(array_length(v_changed, 1), 0) then
    raise exception using errcode = 'P0001', message = 'profile_field_cooldown';
  end if;

  -- ── Move between the official groups the replaced values created ──
  -- One move row per changed dimension: the community tied to the old value
  -- is left, the one tied to the new value is joined (upserting the
  -- community row the same way auto-join does at signup).
  for v_move in
    select mv.type, mv.old_ref, mv.new_ref, mv.new_master_name, mv.new_image
      from (values
        ('city', v_city_id, p_city_id,
          (select c.name from public.cities as c
            where c.id = p_city_id and c.is_active),
          (select c.image_url from public.cities as c
            where c.id = p_city_id and c.is_active)),
        ('sector', v_sector_id, p_sector_id,
          (select s.name from public.design_sectors as s
            where s.id = p_sector_id and s.is_active),
          (select s.image_url from public.design_sectors as s
            where s.id = p_sector_id and s.is_active)),
        ('experience_level',
          (select e.id from public.experience_levels as e where e.slug = v_experience_level),
          (select e.id from public.experience_levels as e where e.slug = p_experience_level),
          (select e.name from public.experience_levels as e
            where e.slug = p_experience_level and e.is_active),
          (select e.image_url from public.experience_levels as e
            where e.slug = p_experience_level and e.is_active)),
        ('job_title',
          (select j.id from public.job_titles as j where j.slug = v_job_title),
          (select j.id from public.job_titles as j where j.slug = p_job_title),
          (select j.name from public.job_titles as j
            where j.slug = p_job_title and j.is_active),
          (select j.image_url from public.job_titles as j
            where j.slug = p_job_title and j.is_active))
      ) as mv(type, old_ref, new_ref, new_master_name, new_image)
     where (mv.type = 'city' and v_city_changed)
        or (mv.type = 'sector' and v_sector_changed)
        or (mv.type = 'experience_level' and v_experience_changed)
        or (mv.type = 'job_title' and v_job_title_changed)
  loop
    -- Leave the group tied to the replaced value. Official groups are
    -- system-created and ownerless; the owner guard is a belt for the
    -- braces so a swap can never orphan a group someone owns.
    for v_group in
      select c.id, c.name, c.image_url
        from public.communities as c
       where c.type = v_move.type
         and c.reference_id = v_move.old_ref
         and v_move.old_ref is not null
         and (c.owner_id is null or c.owner_id <> p_user_id)
    loop
      delete from public.community_members as m
       where m.community_id = v_group.id
         and m.user_id = p_user_id;

      if found then
        delete from public.community_admin_permissions as p
         where p.community_id = v_group.id
           and p.user_id = p_user_id;

        v_left := v_left || jsonb_build_object(
          'id', v_group.id,
          'name', v_group.name,
          'image_url', v_group.image_url
        );
      end if;
    end loop;

    -- Join the group the new value implies. "Other" (the catch-all in the
    -- master tables) has no dedicated group — see auto-join — so those
    -- members stay in General, which is never touched here.
    if v_move.new_ref is not null
       and v_move.new_master_name is not null
       and lower(btrim(v_move.new_master_name)) <> 'other' then
      insert into public.communities as c (type, reference_id, name, image_url)
      values (
        v_move.type,
        v_move.new_ref,
        case v_move.type
          when 'city' then v_move.new_master_name || ' Designers'
          when 'sector' then v_move.new_master_name || ' Community'
          else v_move.new_master_name
        end,
        v_move.new_image
      )
      on conflict (type, reference_id) do update
        set name = excluded.name,
            image_url = excluded.image_url
      returning c.id, c.name, c.image_url
        into v_community_id, v_community_name, v_community_image;

      -- Best-effort under the 7-community cap (see the creation-limits
      -- migration): an identity edit swaps groups net-neutrally — the old
      -- membership was deleted above — so the only case the cap bites is a
      -- member already at the cap who is setting this dimension for the
      -- first time (nothing to leave). The edit itself must never fail over
      -- that: the membership is skipped, not raised, and the member can join
      -- the group later from Explore.
      select cl.limit_count into v_join_cap
        from public.creation_limits as cl
       where cl.kind = 'community_joins';

      select count(*) into v_member_count
        from public.community_members as m
        join public.communities as mc on mc.id = m.community_id
       where m.user_id = p_user_id
         and mc.type <> 'event';

      if v_member_count < coalesce(v_join_cap, 7) then
        insert into public.community_members (community_id, user_id)
        values (v_community_id, p_user_id)
        on conflict (community_id, user_id) do nothing;

        if found then
          v_joined := v_joined || jsonb_build_object(
            'id', v_community_id,
            'name', v_community_name,
            'image_url', v_community_image
          );
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'changed_fields', to_jsonb(v_changed),
    'left_communities', v_left,
    'joined_communities', v_joined
  );
end;
$$;
comment on function public.update_profile_identity(uuid, text, uuid, uuid, text, text) is
  'Atomic identity edit: per-field cooldown gate, profile update and official-group swap; returns the changed fields and the groups left/joined.';

revoke all on function public.update_profile_identity(uuid, text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_profile_identity(uuid, text, uuid, uuid, text, text)
  to service_role;

-- ─── 6. Capped starter of DM conversations (get_or_create_dm_conversation) ──
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
    insert into public.dm_conversations (user_a, user_b)
    values (pair_a, pair_b)
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
                else c.user_b_last_read_at end
      from public.dm_conversations c
     where c.user_a = pair_a
       and c.user_b = pair_b;
end;
$$;

-- The replaced function keeps its service-role-only grants (create or
-- replace preserves ACLs, but they are re-stated so a fresh install and a
-- re-run of this file end in the same place).
revoke all on function public.get_or_create_dm_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_dm_conversation(uuid, uuid) to service_role;

-- ─── 7. Admin override: join-all-communities ────────────────
-- The member-detail admin tool puts a member into every community. That is
-- an operator action, not a member bypass, so it runs with the escape hatch
-- on — inside this function's transaction only. Nothing else may set it.
create or replace function public.admin_join_all_communities(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  perform set_config('app.bypass_creation_limits', 'on', true);

  insert into public.community_members (community_id, user_id)
  select c.id, p_user_id
    from public.communities as c
  on conflict (community_id, user_id) do nothing;

  select count(*) into v_total
    from public.community_members as m
   where m.user_id = p_user_id;

  return v_total;
end;
$$;

comment on function public.admin_join_all_communities(uuid) is
  'Operator override: joins the member into every community despite the join cap (transaction-local bypass), returns their total memberships.';

revoke all on function public.admin_join_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.admin_join_all_communities(uuid) to service_role;

-- ─── 8. Backfill: make the budgets fair on day one ──────────
-- Seeds the counters from rows that already exist so nobody gets a fresh
-- allowance on top of today's or this month's creations. Idempotent: re-running the
-- file never double-counts and never lowers an existing counter. The DM
-- counter is deliberately NOT backfilled — the row does not record who
-- started the conversation, and counting received pairs would punish
-- receivers; DM counting starts at zero with a one-month grace.

insert into public.usage_counters (user_id, kind, period_key, count)
select t.user_id,
       'posts_daily',
       to_char((now() at time zone 'utc'), 'YYYY-MM-DD'),
       count(*)
  from (
    select ct.user_id
      from public.community_threads as ct
     where ct.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    union all
    select cs.user_id
      from public.community_showcase_posts as cs
     where cs.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  ) as t
 group by t.user_id
on conflict (user_id, kind, period_key) do nothing;

insert into public.usage_counters (user_id, kind, period_key, count)
select ce.user_id,
       'events_monthly',
       to_char((now() at time zone 'utc'), 'YYYY-MM'),
       count(*)
  from public.community_events as ce
 where ce.user_id is not null
   and ce.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
 group by ce.user_id
on conflict (user_id, kind, period_key) do nothing;

insert into public.usage_counters (user_id, kind, period_key, count)
select jp.poster_id,
       'jobs_monthly',
       to_char((now() at time zone 'utc'), 'YYYY-MM'),
       count(*)
  from public.job_posts as jp
 where jp.poster_id is not null
   and jp.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')
 group by jp.poster_id
on conflict (user_id, kind, period_key) do nothing;

insert into public.usage_counters (user_id, kind, period_key, count)
select c.owner_id, 'communities_total', 'total', count(*)
  from public.communities as c
 where c.type = 'user'
   and c.owner_id is not null
 group by c.owner_id
on conflict (user_id, kind, period_key) do nothing;
