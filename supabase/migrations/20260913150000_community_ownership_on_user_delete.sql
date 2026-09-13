-- ============================================================
-- Community ownership across user deletion
--
-- Deleting a member used to orphan every community they had created:
-- `communities.owner_id` is `references users(id) on delete set null`, so the
-- community row survived with NO owner, stayed `is_active`, and kept showing up
-- in Explore → "Member-led" as long as any member row remained. Nothing in the
-- app ever cleaned those rows up, so the community outlived the account.
--
-- This migration:
--   1. Purges the member-led communities already left ownerless.
--   2. Transfers ownership on delete — the longest-standing remaining member
--      becomes the owner, mirroring DELETE /api/communities/[id]/members where
--      the owner leaving hands the community over.
--   3. Handles the last-member case: if nobody is left, the community and all
--      of its content are deleted instead of being left ownerless.
--   4. Stops NEW ownerless member-led communities with a check constraint.
--
-- It runs as a BEFORE DELETE trigger on `public.users`, so it holds for every
-- deletion path (admin API, SQL editor, future flows) — not just the one
-- Next.js route that exists today.
--
-- R2 media cannot be deleted from SQL. Communities removed here leave their
-- objects in the bucket; the admin orphan audit (Tools → R2 storage health,
-- /api/admin/r2-audit) reclaims them, and the admin user-delete route cleans
-- them eagerly for the communities it knows it is about to remove.
-- ============================================================


-- ─── 1. Purge existing ownerless member-led communities ─────
-- Snapshot the ids first: lottie_settings is keyed by text (scope/scope_key),
-- not a FK, so it survives the community cascade and must be removed by hand.
do $$
declare
  orphan_ids uuid[];
begin
  select coalesce(array_agg(id), '{}')
    into orphan_ids
    from public.communities
   where type = 'user'
     and owner_id is null;

  if array_length(orphan_ids, 1) is null then
    return;
  end if;

  delete from public.lottie_settings
   where scope = 'community'
     and scope_key = any (orphan_ids::text[]);

  -- Members, messages, threads, comments, showcase posts, events, RSVPs,
  -- resources and join requests all cascade from the community row.
  delete from public.communities
   where id = any (orphan_ids);
end $$;


-- ─── 2. Hand communities over (or remove them) on user delete ───
create or replace function public.handle_owned_communities_on_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned      record;
  next_owner uuid;
begin
  for owned in
    select c.id
      from public.communities as c
     where c.owner_id = old.id
     order by c.created_at asc, c.id asc
  loop
    -- Longest-standing member who is not the departing user — the same rule
    -- the in-app "owner leaves" flow (DELETE /api/communities/[id]/members)
    -- uses, so both paths hand a community over identically.
    select cm.user_id
      into next_owner
      from public.community_members as cm
      join public.users as u on u.id = cm.user_id
     where cm.community_id = owned.id
       and cm.user_id <> old.id
     order by cm.joined_at asc, cm.user_id asc
     limit 1;

    if next_owner is not null then
      update public.communities
         set owner_id = next_owner
       where id = owned.id;

      update public.community_members
         set role = 'owner'
       where community_id = owned.id
         and user_id = next_owner;
    else
      -- Nobody left to hand it to: drop the community rather than leave it
      -- ownerless and permanently unmanageable. lottie_settings is not
      -- covered by the FK cascade, so delete it first.
      delete from public.lottie_settings
       where scope = 'community'
         and scope_key = owned.id::text;

      delete from public.communities where id = owned.id;
    end if;
  end loop;

  return old;
end;
$$;

comment on function public.handle_owned_communities_on_user_delete() is
  'Before a user is deleted, hands each community they own to the longest-standing remaining member, or deletes the community when it would be left with no owner.';

drop trigger if exists trg_handle_owned_communities_on_user_delete on public.users;

create trigger trg_handle_owned_communities_on_user_delete
  before delete on public.users
  for each row execute function public.handle_owned_communities_on_user_delete();


-- ─── 3. No new ownerless member-led communities ─────────────
-- `not valid` keeps the migration safe if a stray row this script did not
-- catch is still around; the constraint still applies to every INSERT/UPDATE
-- from here on, and in practice step 1 removed all of them.
alter table public.communities
  drop constraint if exists communities_user_requires_owner;

alter table public.communities
  add constraint communities_user_requires_owner
  check (type <> 'user' or owner_id is not null) not valid;


-- ─── 4. Keep ownerless member-led communities out of Explore ───
-- Defence in depth: step 3 makes these rows impossible, but the feed should
-- never be able to surface one even if data is restored from an older dump.
-- Row shape is unchanged; only the filter grows.
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
  ),
  membership_aggregates as (
    select
      cm.community_id,
      count(*) as member_count,
      bool_or(cm.user_id = p_user_id) as joined
    from public.community_members as cm
    group by cm.community_id
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
    members.member_count,
    members.joined,
    case
      when c.type in ('interest', 'general', 'user') then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      when c.type = 'job_title' then profile.job_title_id = c.reference_id
      else false
    end as can_join
  from public.communities as c
  join membership_aggregates as members on members.community_id = c.id
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
    and (c.type <> 'user' or c.owner_id is not null)
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
  'Returns the response-ready active community explore list in one query. Member-led communities are only listed while they still have an owner.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;
