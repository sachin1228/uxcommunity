-- ============================================================
-- Remove the design-interests feature
--
-- WHY
--   Interests were introduced as a signup profile attribute, and each one
--   materialised an empty "interest" community the moment a member picked it.
--   That filled Explore with low-signal default groups nobody asked for, and
--   the attribute no longer feeds onboarding (signup stopped collecting
--   interests) or anything else.
--
-- WHAT
--   1. Delete the `interest` communities (their memberships, messages,
--      threads, events, resources, showcase posts, rules, admins and
--      notifications all cascade from the community row).
--   2. Tighten `communities_type_check` so the type cannot come back.
--   3. Drop the `user_interests` join table and the `design_interests`
--      master table.
--   4. Redefine the functions that resolved interest rows:
--      `complete_signup` (loses `p_interest_ids`), `get_all_communities`,
--      `get_home_feed_page` and `get_profile_feed_page`.
--
-- Deploy note: apply this with the web release that stops querying
-- `design_interests` / `user_interests` (profile page, /api/profile).
-- Runs after 20261008130000_drop_general_community.sql, so the type check it
-- re-adds lists the types that survive both retirements.
-- ============================================================

-- ─── 1. Delete the interest communities ─────────────────────
-- Community-scoped animation settings have no FK to communities; clear them
-- before the community rows, the way the user-delete handler does.
delete from public.lottie_settings
 where scope = 'community'
   and scope_key in (
     select c.id::text from public.communities as c where c.type = 'interest'
   );

delete from public.lottie_settings
 where scope = 'type'
   and scope_key = 'interest';

delete from public.communities
 where type = 'interest';

-- ─── 2. The type cannot be created again ────────────────────
alter table public.communities
  drop constraint if exists communities_type_check;

alter table public.communities
  add constraint communities_type_check
  check (type in ('city', 'sector', 'experience_level', 'job_title', 'user', 'event'));

-- ─── 3. Drop the interest tables ────────────────────────────
-- user_interests first: it holds the FK to design_interests.
drop table if exists public.user_interests;
drop table if exists public.design_interests;

-- ─── 4. complete_signup without p_interest_ids ──────────────
-- Removing a parameter changes the signature, so the old function is dropped
-- first (same approach as 20260913120000_add_job_titles.sql).
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
  text, text, text, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.complete_signup(
  text, text, text, uuid, uuid, text, text, text, text, text
) to service_role;

-- ─── 5. get_all_communities without interest rows ───────────
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
  )
  select
    c.id,
    c.name,
    c.type,
    coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ) as image_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_url
        when 'sector' then sector.lottie_url
        when 'experience_level' then experience.lottie_url
        when 'job_title' then job.lottie_url
      end,
      c.lottie_url
    ) as lottie_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_format
        when 'sector' then sector.lottie_format
        when 'experience_level' then experience.lottie_format
        when 'job_title' then job.lottie_format
      end,
      c.lottie_format
    ) as lottie_format,
    c.description,
    coalesce(c.is_private, false) as is_private,
    c.member_count::bigint,
    exists (
      select 1
      from public.community_members cm
      where cm.community_id = c.id
        and cm.user_id = p_user_id
    ) as joined,
    case
      when c.type = 'user' then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      when c.type = 'job_title' then profile.job_title_id = c.reference_id
      else false
    end as can_join
  from public.communities as c
  left join profile on true
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  where c.is_active = true
    and c.member_count > 0
    and c.type <> 'event'
    and case c.type
      when 'city' then city.id is not null
      when 'sector' then sector.id is not null
      when 'experience_level' then experience.id is not null
      when 'job_title' then job.id is not null
      else true
    end
  order by c.name;
$$;

comment on function public.get_all_communities(uuid) is
  'Returns the response-ready active community explore list in one query (event group chats excluded). member_count is read from communities.member_count rather than aggregated from community_members.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;

-- ─── 6. get_home_feed_page without interest rows ────────────
create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30,
  p_scope text default 'all'
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with my_communities as (
    select m.community_id
    from public.community_members m
    where m.user_id = p_user_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where t.community_id is not null
      and case p_scope
        when 'communities' then t.community_id in (select community_id from my_communities)
        when 'public' then t.is_public and t.community_id not in (select community_id from my_communities)
        else t.is_public
      end
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.community_id is not null
      and case p_scope
        when 'communities' then e.community_id in (select community_id from my_communities)
        when 'public' then e.is_public and e.community_id not in (select community_id from my_communities)
        else e.is_public
      end
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.community_id is not null
      and case p_scope
        when 'communities' then r.community_id in (select community_id from my_communities)
        when 'public' then r.is_public and r.community_id not in (select community_id from my_communities)
        else r.is_public
      end
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.community_id is not null
      and case p_scope
        when 'communities' then s.community_id in (select community_id from my_communities)
        when 'public' then s.is_public and s.community_id not in (select community_id from my_communities)
        else s.is_public
      end
      and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.get_home_feed_page(uuid, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer, text) to service_role;

-- ─── 7. get_profile_feed_page without interest rows ─────────
create or replace function public.get_profile_feed_page(
  p_user_id uuid,
  p_scope text default 'all',
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where p_scope in ('all', 'thread') and t.user_id = p_user_id and t.community_id is not null
    union all
    select 'thread', t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t)
    from public.thread_saves s
    join public.community_threads t on t.id = s.thread_id
    where p_scope in ('all', 'thread', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or t.user_id <> p_user_id) and t.community_id is not null
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where p_scope in ('all', 'event') and e.user_id = p_user_id and e.community_id is not null
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.event_saves s
    join public.community_events e on e.id = s.event_id
    where p_scope in ('all', 'event', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or e.user_id <> p_user_id) and e.community_id is not null
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where p_scope in ('all', 'resource') and r.user_id = p_user_id and r.community_id is not null
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.resource_saves s
    join public.community_resources r on r.id = s.resource_id
    where p_scope in ('all', 'resource', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or r.user_id <> p_user_id) and r.community_id is not null
    union all
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.community_showcase_posts p
    where p_scope in ('all', 'showcase') and p.user_id = p_user_id and p.community_id is not null
    union all
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.showcase_saves s
    join public.community_showcase_posts p on p.id = s.post_id
    where p_scope in ('all', 'showcase', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or p.user_id <> p_user_id) and p.community_id is not null
  ), page as (
    select * from candidates
    where p_before is null or candidates.created_at < p_before
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
  )
  select p.payload || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.get_profile_feed_page(uuid, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_profile_feed_page(uuid, text, timestamptz, integer) to service_role;
