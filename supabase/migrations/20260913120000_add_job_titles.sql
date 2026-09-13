-- ============================================================
-- Job Title: a new first-class profile dimension
--
-- Mirrors experience_levels:
--   • job_titles master table (admin-managed, with image + Lottie DP)
--   • designer_profiles.job_title stores the chosen slug
--   • communities.type gains 'job_title' so each title gets its own
--     auto-created community (reference_id = job_titles.id)
--   • complete_signup accepts + validates p_job_title
--   • get_all_communities resolves job title DPs + can_join
-- ============================================================

-- ─── 1. job_titles master table ─────────────────────────────
create table if not exists public.job_titles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  image_url     text,
  lottie_url    text,
  lottie_format text check (lottie_format is null or lottie_format in ('json', 'dotlottie')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.job_titles (slug, name) values
  ('product_designer',  'Product Designer'),
  ('ux_designer',       'UX Designer'),
  ('ui_visual_designer','UI / Visual Designer'),
  ('graphic_designer',  'Graphic Designer'),
  ('motion_3d_designer','Motion & 3D Designer'),
  ('design_engineer',   'Design Engineer')
on conflict (slug) do nothing;

-- Keep updated_at fresh on every update.
create or replace function public.set_job_titles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_job_titles_updated_at on public.job_titles;
create trigger trg_job_titles_updated_at
  before update on public.job_titles
  for each row execute function public.set_job_titles_updated_at();

alter table public.job_titles enable row level security;

-- `drop … if exists` + create keeps this idempotent on re-run without a
-- DO/PL-pgSQL block.
drop policy if exists "public_read" on public.job_titles;
create policy "public_read" on public.job_titles for select using (true);

-- ─── 2. designer_profiles.job_title ─────────────────────────
-- Nullable: profiles created before this migration keep working until the
-- member picks a title. New signups always set it.
alter table public.designer_profiles
  add column if not exists job_title text;

create index if not exists idx_profiles_job_title
  on public.designer_profiles (job_title);

-- Reference the master slug so an in-use job title cannot be deleted (mirrors
-- the cities / design_sectors RESTRICT behaviour). Nullable, so profiles from
-- before this migration stay valid until they pick a title.
alter table public.designer_profiles
  drop constraint if exists designer_profiles_job_title_fkey;

alter table public.designer_profiles
  add constraint designer_profiles_job_title_fkey
  foreign key (job_title) references public.job_titles (slug) on delete restrict;

-- ─── 3. Allow the job_title community type ──────────────────
alter table public.communities
  drop constraint if exists communities_type_check;

alter table public.communities
  add constraint communities_type_check
  check (type in ('city', 'sector', 'interest', 'experience_level', 'job_title', 'general', 'user'));

-- ─── 4. complete_signup gains p_job_title ───────────────────
-- New parameter changes the signature, so the old function must be dropped.
-- Both signatures are dropped so this migration is safe to re-run.
drop function if exists public.complete_signup(
  text, text, text, uuid, uuid, text, uuid[], text, text, text
);
drop function if exists public.complete_signup(
  text, text, text, uuid, uuid, text, text, uuid[], text, text, text
);

create function public.complete_signup(
  p_name text,
  p_email text,
  p_password_hash text,
  p_city_id uuid,
  p_sector_id uuid,
  p_experience_level text,
  p_job_title text,
  p_interest_ids uuid[],
  p_avatar_url text,
  p_avatar_source text,
  p_invitation_token text default null
)
returns table (user_id uuid, application_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_user_id uuid;
begin
  if nullif(btrim(p_name), '') is null
     or nullif(btrim(p_email), '') is null
     or nullif(p_password_hash, '') is null
     or nullif(p_experience_level, '') is null
     or nullif(p_job_title, '') is null
     or (p_avatar_url is null) <> (p_avatar_source is null)
     or (p_avatar_source is not null and p_avatar_source <> 'upload') then
    raise exception using errcode = '22023', message = 'invalid_signup_payload';
  end if;

  if p_invitation_token is not null then
    select i.application_id
      into v_application_id
      from public.invitations as i
     where i.token = p_invitation_token
       and i.used_at is null
       and i.expires_at >= now()
     for update;

    if v_application_id is null then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;

    if exists (
      select 1 from public.users as u
       where u.application_id = v_application_id
    ) then
      raise exception using errcode = '23505', message = 'application_already_registered';
    end if;
  end if;

  if exists (select 1 from public.users as u where lower(u.email) = lower(p_email)) then
    raise exception using errcode = '23505', message = 'email_already_registered';
  end if;

  if not exists (select 1 from public.cities as c where c.id = p_city_id and c.is_active)
     or not exists (select 1 from public.design_sectors as s where s.id = p_sector_id and s.is_active)
     or not exists (select 1 from public.experience_levels as e where e.slug = p_experience_level and e.is_active)
     or not exists (select 1 from public.job_titles as j where j.slug = p_job_title and j.is_active) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if exists (
    select 1
      from unnest(coalesce(p_interest_ids, array[]::uuid[])) as requested(id)
      left join public.design_interests as interest
        on interest.id = requested.id and interest.is_active
     where interest.id is null
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_interest';
  end if;

  insert into public.users (application_id, name, email, password_hash)
  values (v_application_id, btrim(p_name), lower(btrim(p_email)), p_password_hash)
  returning id into v_user_id;

  insert into public.designer_profiles (
    user_id,
    city_id,
    sector_id,
    experience_level,
    job_title,
    avatar_url,
    avatar_source
  ) values (
    v_user_id,
    p_city_id,
    p_sector_id,
    p_experience_level,
    p_job_title,
    p_avatar_url,
    p_avatar_source
  );

  insert into public.user_interests (user_id, interest_id)
  select v_user_id, requested.id
    from (
      select distinct id
        from unnest(coalesce(p_interest_ids, array[]::uuid[])) as selected(id)
    ) as requested;

  if v_application_id is not null then
    update public.invitations
       set used_at = now()
     where token = p_invitation_token
       and application_id = v_application_id
       and used_at is null;

    if not found then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;
  end if;

  return query select v_user_id, v_application_id;
end;
$$;

revoke all on function public.complete_signup(
  text, text, text, uuid, uuid, text, text, uuid[], text, text, text
) from public, anon, authenticated;

grant execute on function public.complete_signup(
  text, text, text, uuid, uuid, text, text, uuid[], text, text, text
) to service_role;

-- ─── 5. get_all_communities resolves job titles ─────────────
-- Return row shape is unchanged; only the resolution joins / can_join grow.
drop function if exists public.get_all_communities(uuid);

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
  'Returns the response-ready active community explore list in one query.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;

-- ─── 6. Backfill: create a community per existing job title ─
-- Communities are normally upserted at signup / dashboard repair, but seeding
-- them here keeps the admin Communities list populated immediately.
insert into public.communities (name, type, reference_id, image_url, lottie_url, lottie_format)
select
  j.name,
  'job_title',
  j.id,
  j.image_url,
  j.lottie_url,
  j.lottie_format
from public.job_titles as j
where j.is_active
on conflict (type, reference_id) do nothing;
