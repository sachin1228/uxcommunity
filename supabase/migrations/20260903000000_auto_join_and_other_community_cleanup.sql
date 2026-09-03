-- ============================================================
-- Auto-join completeness + "Other" community cleanup
--
-- 1. designer_profiles.communities_auto_joined lets the dashboard repair
--    missing profile communities exactly once per member (new signups are
--    auto-joined server-side during /api/signup/avatar; accounts created
--    before that heal on their next dashboard visit, then the flag is set
--    so later community leaves are respected).
--
-- 2. Selecting "Other" for city or sector no longer creates a dedicated
--    community — those members belong to the always-joined General
--    community. Existing catch-all "Other …" communities (created before
--    this change) are soft-hidden (is_active = false, content preserved)
--    and their members are folded into General.
-- ============================================================

alter table public.designer_profiles
  add column if not exists communities_auto_joined boolean not null default false;

do $$
declare
  v_general_id uuid;
begin
  select id into v_general_id
    from public.communities
   where type = 'general'
   limit 1;

  if v_general_id is null then
    return;
  end if;

  -- Fold members of catch-all "Other" city/sector communities into General.
  insert into public.community_members (community_id, user_id, joined_at)
  select v_general_id, cm.user_id, least(cm.joined_at, now())
    from public.community_members as cm
    join public.communities as c on c.id = cm.community_id
    left join public.community_members as existing
      on existing.community_id = v_general_id
     and existing.user_id = cm.user_id
   where existing.user_id is null
     and c.type in ('city', 'sector')
     and c.reference_id in (
       select id from public.cities
        where lower(trim(name)) = 'other'
       union
       select id from public.design_sectors
        where lower(trim(name)) = 'other'
     );

  -- Soft-hide the catch-all communities; content and history are preserved.
  update public.communities as c
     set is_active = false
   where c.type in ('city', 'sector')
     and c.reference_id in (
       select id from public.cities
        where lower(trim(name)) = 'other'
       union
       select id from public.design_sectors
        where lower(trim(name)) = 'other'
     );
end;
$$;
