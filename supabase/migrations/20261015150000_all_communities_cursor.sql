-- The Explore directory stops reading the whole platform on every visit.
--
-- WHY (measured, see docs/supabase-egress-audit.md §4 #2)
--   `get_all_communities` had no LIMIT: every Explore visit, and every homepage
--   render behind the rail's 60 s cache, read EVERY active community. Measured
--   372 B raw / 73.8 B on the wire per row — which is the one hotspot in this
--   audit whose cost grows with total platform content rather than with the
--   member's own usage. At 5,000 communities that is ~1.85 MB raw (~368 KB wire)
--   per request, per member.
--
-- WHAT
--   1. `get_all_communities` takes a bound and a KEYSET CURSOR. Ordering becomes
--      (name, id) — the existing `order by c.name` with a tie-break, because a
--      cursor needs a total order to be correct: two communities sharing a name
--      must not be able to hide each other between pages. The page is clamped to
--      1..500 rows, so no caller can ask for the unbounded read back.
--
--      The cursor halves are both required together: given a name but no id the
--      predicate degenerates to `name >= p_after_name` and would repeat the
--      boundary row. The route sends both or neither (same contract and same
--      guard as the jobs board's cursor in 20261015120000_job_feed_cursor).
--
--   2. `get_suggested_communities` is new, and exists because the homepage rail
--      cannot use a name-ordered page. Its rule is "the biggest communities this
--      member could one-tap join" — a top-N BY MEMBER COUNT, which a cursor over
--      names can never express. Asking the old function for a page would have
--      quietly narrowed the rail to the alphabetically first communities, so the
--      selection moved into SQL instead: filter, order and bound in the database,
--      and the rail reads 4-ish rows instead of the whole table.
--
-- COMPATIBILITY
--   The old one-argument signature is dropped rather than left beside the new
--   one: two overloads differing in defaults make every existing named-argument
--   call ambiguous. Every caller is service-role code in this repository (the
--   Explore route, the homepage rail, and the SQL tests), and the new signature
--   keeps `p_user_id`'s position, so the tests' positional one-argument calls
--   still resolve through the defaults.

drop function if exists public.get_all_communities(uuid);

create or replace function public.get_all_communities(
  p_user_id    uuid,
  -- One page. Clamped to 1..500, so the unbounded read cannot be requested.
  p_limit      integer default 60,
  -- Keyset cursor: the (name, id) of the last row of the previous page.
  p_after_name text default null,
  p_after_id   uuid default null
)
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
  can_join boolean,
  has_pending_request boolean
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
    end as can_join,
    exists (
      select 1
      from public.community_join_requests cjr
      where cjr.community_id = c.id
        and cjr.user_id = p_user_id
        and cjr.status = 'pending'
    ) as has_pending_request
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
    -- The keyset cursor, on the same pair the ORDER BY sorts by. A null
    -- p_after_name is the first page; both halves are sent together.
    and (p_after_name is null or (c.name, c.id) > (p_after_name, p_after_id))
  order by c.name, c.id
  limit least(greatest(coalesce(p_limit, 60), 1), 500);
$$;

comment on function public.get_all_communities(uuid, integer, text, uuid) is
  'Returns ONE PAGE of the response-ready active community explore list (event group chats excluded), ordered by (name, id) and paged by the keyset cursor (p_after_name, p_after_id). member_count is read from communities.member_count rather than aggregated from community_members. has_pending_request is true when the caller has an unresolved join request for the community.';

revoke all on function public.get_all_communities(uuid, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid, integer, text, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_suggested_communities — the homepage rail's bounded read.
--
-- The rail suggests the biggest communities a member could join in one tap, so
-- it needs a top-N by member count, not a page of a name-ordered list. Returning
-- the whole table for it (which is what it used to read) meant every dashboard
-- render paid for the entire platform behind its 60 s cache; this returns at most
-- `p_limit` rows and nothing else.
--
-- The rules are the ones the rail already applied in TypeScript
-- (lib/home/suggested.ts, unit tested there): open, joinable, not already joined,
-- not private, and member-created (`type = 'user'`) — profile-derived
-- communities are auto-joined at signup, so they are never a discovery. For
-- `type = 'user'` the join rule is unconditional (see the CASE above), hence
-- `can_join` is a constant here rather than a second copy of that logic.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_suggested_communities(
  p_user_id uuid,
  p_limit   integer default 8
)
returns table (
  id uuid,
  name text,
  type text,
  image_url text,
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
  select
    c.id,
    c.name,
    c.type,
    c.image_url,
    c.description,
    coalesce(c.is_private, false) as is_private,
    c.member_count::bigint,
    false as joined,
    true as can_join
  from public.communities as c
  where c.is_active = true
    and c.member_count > 0
    and c.type = 'user'
    and coalesce(c.is_private, false) = false
    and not exists (
      select 1
      from public.community_members cm
      where cm.community_id = c.id
        and cm.user_id = p_user_id
    )
  order by c.member_count desc, c.name asc, c.id asc
  limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;

comment on function public.get_suggested_communities(uuid, integer) is
  'The homepage rail''s bounded suggestion read: the member-created, active, non-private, not-yet-joined communities with the most members, biggest first, at most p_limit rows (clamped to 1..50). Same eligibility rules as lib/home/suggested.ts.';

revoke all on function public.get_suggested_communities(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_suggested_communities(uuid, integer) to service_role;
