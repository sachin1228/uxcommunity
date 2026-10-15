-- The jobs FEED stops carrying prose.
--
-- WHY (measured, see docs/supabase-egress-audit.md §4 #1)
--   Supabase bills the bytes its PostgREST responses transmit, and `get_job_feed`
--   was the largest payload in the application: 1,460 B *on the wire* per posting
--   measured over real HTTP, ~73 KB for a 50-row board page. 81% of each row was
--   `description` text — and prose is what compresses worst: that payload came
--   back at 40.6% of its raw size, against 14–20% for the key-heavy JSON the rest
--   of the app returns. So it was the biggest payload AND the least compressible,
--   to render board cards that show none of it.
--
-- WHAT
--   `job_post_payload` gains `p_include_prose`. ONE definition, not two: the card
--   payload IS the detail payload with three keys removed, and the removal happens
--   inside the database, before the row is serialized — so the two shapes cannot
--   drift the way two hand-maintained builders would. `get_job_feed` passes false;
--   `get_job_detail` keeps the default and still carries the full posting.
--
--   The prose keys are stripped rather than never built. That costs a few
--   microseconds of jsonb work per row on columns the join has already read, and
--   query processing is not billed as egress — whereas a second copy of this
--   hundred-line builder is a correctness liability forever. The bytes are what
--   the bill counts, and the bytes are gone before they leave.
--
--   `skills` deliberately STAYS in the card payload: the board's own search box
--   filters on it (`JobsBrowser`), so it is card data, not detail data.
--
-- COMPATIBILITY
--   The two-argument `job_post_payload` is dropped rather than left beside the new
--   one: adding a parameter WITH a default while the old signature still exists
--   would leave two overloads of one builder, and every caller is service-role
--   code in this repository (the two feed functions and the SQL tests), all of
--   which keep working through the default.

drop function if exists public.job_post_payload(uuid, uuid);

create or replace function public.job_post_payload(
  p_job_id        uuid,
  p_viewer_id     uuid,
  -- False for list rows: omits description / responsibilities / requirements.
  p_include_prose boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select (
    jsonb_build_object(
      'id', jp.id,
      'kind', jp.kind,
      'title', jp.title,
      'description', jp.description,
      'responsibilities', to_jsonb(jp.responsibilities),
      'requirements', to_jsonb(jp.requirements),
      'skills', to_jsonb(jp.skills),
      'salary', jp.salary,
      'website', jp.website,
      'work_mode', jp.work_mode,
      'employment_type', jp.employment_type,
      'city_id', jp.city_id,
      -- NULL is the All wildcard; the payload resolves it to the label
      -- the cards render, beside the ids the forms hold.
      'city_name', coalesce(ci.name, 'All cities'),
      'sector_id', jp.sector_id,
      'sector_name', coalesce(se.name, 'All sectors'),
      'job_title', jp.job_title,
      'job_title_label', coalesce(jt.name, jp.job_title),
      'experience_level', jp.experience_level,
      'experience_level_label', coalesce(el.name, jp.experience_level),
      'created_at', jp.created_at,
      'status', jp.status,
      'updated_at', jp.updated_at,
      -- The deadline and its verdict travel together: the client renders the
      -- date, and `can_apply` below is the authority on whether it still counts.
      'closes_at', jp.closes_at,
      'company', jsonb_build_object(
        'id', co.id,
        'name', co.name,
        'slug', co.slug,
        'logo_url', co.logo_url,
        -- The display domain: verified first, else the directory's best hint
        -- (same ordering search_companies uses), so the logo resolves the same
        -- way everywhere. `domain_verified` still says whether a proof exists.
        'domain', (
          select d.domain from public.company_domains as d
          where d.company_id = co.id
          order by d.verified desc,
                   public.company_confidence_rank(d.evidence_confidence) desc,
                   d.created_at asc,
                   d.domain asc
          limit 1
        ),
        'domain_verified', exists (
          select 1 from public.company_domains as d
          where d.company_id = co.id and d.verified
        )
      ),
      'poster', jsonb_build_object(
        'id', pu.id,
        'name', pu.name,
        'avatar_url', pd.avatar_url,
        'job_title', pd.job_title,
        'job_title_label', pjt.name,
        'experience_level', pd.experience_level,
        'experience_level_label', pel.name,
        -- Where the poster works, the same company their profile shows.
        'company_name', pc.name
      ),
      'applicant_count', (
        select count(*) from public.job_applications as ja where ja.job_id = jp.id
      ),
      -- The edit rule the database enforces, exposed so the form disables
      -- the four targeting fields instead of re-deriving when they lock.
      'criteria_locked', exists (
        select 1 from public.job_applications as ja where ja.job_id = jp.id
      ),
      'applied', exists (
        select 1 from public.job_applications as ja
        where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
      ),
      'is_mine', jp.poster_id = p_viewer_id,
      -- The same rule apply_to_job enforces, read from the same expression:
      -- the posting is open, and the viewer's profile matches it — job title
      -- and experience level exactly, city and sector unless the posting set
      -- them to All (NULL).
      'can_apply', (
        public.job_post_is_open(jp.status, jp.closes_at)
        and p_viewer_id is not null
        and jp.poster_id <> p_viewer_id
        and not exists (
          select 1 from public.job_applications as ja
          where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
        )
        and exists (
          select 1 from public.designer_profiles as vp
          where vp.user_id = p_viewer_id
            and (jp.city_id is null or vp.city_id = jp.city_id)
            and (jp.sector_id is null or vp.sector_id = jp.sector_id)
            and vp.job_title = jp.job_title
            and vp.experience_level = jp.experience_level
        )
      ),
      'my_application', ma.application
    )
    -- Subtracting an empty array is a no-op, so the detail path runs exactly the
    -- builder it always did.
    - case
        when p_include_prose then '{}'::text[]
        else array['description', 'responsibilities', 'requirements']::text[]
      end
  )
  from public.job_posts as jp
  join public.companies as co on co.id = jp.company_id
  join public.users as pu on pu.id = jp.poster_id
  left join public.designer_profiles as pd on pd.user_id = jp.poster_id
  left join public.companies as pc on pc.id = pd.company_id
  left join public.job_titles as pjt on pjt.slug = pd.job_title
  left join public.experience_levels as pel on pel.slug = pd.experience_level
  left join public.cities as ci on ci.id = jp.city_id
  left join public.design_sectors as se on se.id = jp.sector_id
  left join public.job_titles as jt on jt.slug = jp.job_title
  left join public.experience_levels as el on el.slug = jp.experience_level
  left join lateral (
    select jsonb_build_object(
      'id', ja.id,
      'name', ja.name,
      'portfolio_url', ja.portfolio_url,
      'linkedin_url', ja.linkedin_url,
      'resume_url', ja.resume_url,
      'created_at', ja.created_at
    ) as application
    from public.job_applications as ja
    where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
  ) as ma on true
  where jp.id = p_job_id;
$$;

revoke all on function public.job_post_payload(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.job_post_payload(uuid, uuid, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_job_feed — unchanged body from 20261015120000_job_feed_cursor.sql, except
-- that it asks for the card payload. A posting still keeps every viewer flag
-- (`applied`, `can_apply`, `is_mine`, `criteria_locked`, `my_application`) and
-- the owner's `applicant_count`, because those are what the cards and the rail
-- actually render; only the three prose fields are withheld, and the detail
-- read is one call away (`get_job_detail`, or GET /api/jobs/<id>).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_job_feed(
  p_viewer_id         uuid,
  p_limit             integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id         uuid default null
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select public.job_post_payload(p.job_id, p_viewer_id, false) as item
  from (
    select jp.id as job_id, jp.created_at
    from public.job_posts as jp
    where (public.job_post_is_open(jp.status, jp.closes_at)
           or jp.poster_id = p_viewer_id)
      and (p_before_created_at is null
           or (jp.created_at, jp.id) < (p_before_created_at, p_before_id))
    order by jp.created_at desc, jp.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) as p
  order by p.created_at desc, p.job_id desc;
$$;

revoke all on function public.get_job_feed(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_job_feed(uuid, integer, timestamptz, uuid) to service_role;
