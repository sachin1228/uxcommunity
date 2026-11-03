-- A separate RPC preserves old signup/admin callers during rolling deploys.
create or replace function public.create_login_session(
  p_user_id uuid,
  p_expected_password_hash text,
  p_expires_at timestamptz,
  p_user_agent text default null
) returns table(session_id uuid, session_version integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_session_id uuid;
begin
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'session_expiry_invalid' using errcode = '22023';
  end if;
  -- Password changes/resets and suspensions update this same row. Either this
  -- insert precedes their revocation, or we see their committed new state.
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found or v_user.is_blocked or v_user.suspended_until > now() then
    raise exception 'account_unavailable' using errcode = 'P0001';
  end if;
  if p_expected_password_hash is null or v_user.password_hash is distinct from p_expected_password_hash then
    raise exception 'password_changed' using errcode = 'P0001';
  end if;
  insert into public.auth_sessions(user_id, role, session_version, expires_at, user_agent)
  values (p_user_id, 'user', v_user.session_version, p_expires_at,
    nullif(left(coalesce(p_user_agent, ''), 512), ''))
  returning id into v_session_id;
  return query select v_session_id, v_user.session_version;
end;
$$;
revoke all on function public.create_login_session(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.create_login_session(uuid, text, timestamptz, text) to service_role;

-- One-time, idempotent repair of legacy accounts. This used to run inline on
-- dashboard visits. Never revisit processed profiles: members may have left a
-- community intentionally. Signup and the explicit auto-join API keep working.
do $$
declare
  profile record;
  spec record;
  v_community_id uuid;
  cap integer;
begin
  select coalesce((select limit_count from public.creation_limits where kind = 'community_joins'), 10) into cap;
  for profile in
    select dp.* from public.designer_profiles dp
    where not coalesce(dp.communities_auto_joined, false)
      and (dp.city_id is not null or dp.sector_id is not null or dp.experience_level is not null or dp.job_title is not null)
    order by dp.user_id for update
  loop
    perform pg_advisory_xact_lock(hashtextextended('community_join_cap:' || profile.user_id::text, 0));
    for spec in
      select * from (
        select 1 ord, 'city'::text kind, c.id reference_id, c.name || ' Designers' name, c.image_url
          from public.cities c where c.id = profile.city_id and lower(trim(c.name)) <> 'other'
        union all
        select 2, 'sector', s.id, s.name || ' Community', s.image_url
          from public.design_sectors s where s.id = profile.sector_id and lower(trim(s.name)) <> 'other'
        union all
        select 3, 'experience_level', e.id, e.name, e.image_url
          from public.experience_levels e where e.slug = profile.experience_level and lower(trim(e.name)) <> 'other'
        union all
        select 4, 'job_title', j.id, j.name, j.image_url
          from public.job_titles j where j.slug = profile.job_title and lower(trim(j.name)) <> 'other'
      ) candidates order by ord
    loop
      insert into public.communities(type, reference_id, name, image_url)
      values (spec.kind, spec.reference_id, spec.name, spec.image_url)
      on conflict (type, reference_id) do update set name = excluded.name, image_url = excluded.image_url
      returning id into v_community_id;
      if public.count_join_slots(profile.user_id) < cap then
        insert into public.community_members(community_id, user_id)
        values (v_community_id, profile.user_id)
        on conflict (community_id, user_id) do nothing;
      end if;
    end loop;
    update public.designer_profiles set communities_auto_joined = true where user_id = profile.user_id;
  end loop;
end;
$$;
