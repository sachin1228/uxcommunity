-- ============================================================
-- Profile identity edit: per-field cooldowns + official-group swaps
--
-- WHY
--   The profile hero's Edit action used to hand the member off to Settings,
--   which only edits contact links. Members need to change the identity
--   details they picked during signup — name, job title, experience level,
--   city and industry sector — from a modal on the profile page. Those
--   details are also what places a member in their official groups
--   (General + city + sector + experience level + job title, created at
--   signup / auto-join), so changing one must ALSO move the member between
--   exactly those groups.
--
-- WHAT
--   1. profile_field_changes — one row per member per editable slot, holding
--      the last change timestamp. A slot may change once every three months:
--        name | job title | experience level | city | sector
--   2. update_profile_identity() — the only writer of those columns. It locks
--      the member's rows, enforces the cooldown, updates name/profile
--      columns, records the change timestamps, leaves the communities tied
--      to the replaced values and joins the ones tied to the new values
--      (upserting community rows exactly like lib/communities/auto-join.ts
--      does). One transaction: a failure leaves nothing half-applied.
--   3. Catch-all "Other" values intentionally produce no community (see
--      auto-join) — those members stay in General, which is never touched.
-- ============================================================

-- ─── 1. Cooldown records ────────────────────────────────────
create table if not exists public.profile_field_changes (
  user_id    uuid not null references public.users (id) on delete cascade,
  field      text not null,
  changed_at timestamptz not null default now(),
  primary key (user_id, field)
);

-- The slot set. Re-runnable: an install that applied the earlier version of
-- this migration (where experience level and job title shared one
-- "designation" slot) is migrated in place — the shared lock is granted to
-- both halves, so the split is never LESS strict than before.
alter table public.profile_field_changes
  drop constraint if exists profile_field_changes_field_check;

insert into public.profile_field_changes (user_id, field, changed_at)
select pfc.user_id, slot.field, pfc.changed_at
  from public.profile_field_changes as pfc,
       unnest(array['job_title', 'experience_level']) as slot(field)
 where pfc.field = 'designation'
on conflict (user_id, field) do update set changed_at = excluded.changed_at;

delete from public.profile_field_changes where field = 'designation';

alter table public.profile_field_changes
  add constraint profile_field_changes_field_check
  check (field in ('name', 'job_title', 'experience_level', 'city', 'sector'));

-- No policies on purpose: only the service role reads/writes this table,
-- and it bypasses RLS. (Every other write in this app goes through the
-- service-role key on the server.)
alter table public.profile_field_changes enable row level security;

-- Supabase's project default privileges put every new table within reach of
-- anon/authenticated; drop that here so the Data API never sees this table
-- (the convention every table-creating migration follows — see
-- 20260926000000_close_public_read_exposure.sql and 20260918120000_push_tokens.sql).
revoke all on table public.profile_field_changes from anon, authenticated;

comment on table public.profile_field_changes is
  'Last-change timestamps for the editable identity slots (name, job title, experience level, city, sector); each slot can change once per three months.';

-- ─── 2. The atomic edit ─────────────────────────────────────
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
