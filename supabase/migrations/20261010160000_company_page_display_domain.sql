-- ============================================================
-- The company page's picture resolves from its display domain
--
-- WHY
--   20261009140000_company_display_domain.sql taught the profile
--   (get_user_company) and the jobs payload to resolve a company's
--   picture from the domain the company is KNOWN by — verified when
--   someone proved one, else the directory's best hint — so a company
--   whose members joined through a mailbox-only proof shows its real
--   mark instead of a letter. The company page itself was left out: it
--   reads only VERIFIED domains, so exactly the companies the fix was
--   for (hints nobody has checked yet) render the letter placeholder
--   on their own page while the picker shows the actual mark. Same
--   company, two different pictures.
--
-- WHAT
--   `get_company_page` now also returns `domain`: the display domain
--   with the same ordering every other surface uses —
--     verified desc, confidence rank desc, created_at asc, domain asc
--   The `domains` list and `member_count` keep their proof meaning, so
--   the page still says "No verified domains yet" when nothing has been
--   proved: the picture is decoration, the verified list is the claim.
--
-- Deploy note: the return shape gains a column, which create-or-replace
-- cannot do, so this drops and recreates the function and reapplies its
-- comment and grants. No schema change, no backfill. Apply after
-- 20261010150000_city_event_filters.sql.
-- ============================================================

drop function if exists public.get_company_page(text);

-- The company page: header data (including the picture's domain), every
-- verified domain, verified member count and a preview of recent members.
create function public.get_company_page(p_slug text)
returns table (
  id           uuid,
  name         text,
  slug         text,
  logo_url     text,
  domain       text,
  is_active    boolean,
  created_at   timestamptz,
  member_count bigint,
  domains      jsonb,
  members      jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    domain_row.domain,
    c.is_active,
    c.created_at,
    count(distinct m.user_id) filter (where m.verified) as member_count,
    coalesce(domains.rows, '[]'::jsonb),
    coalesce(members.rows, '[]'::jsonb)
  from public.companies as c
  left join public.company_members as m on m.company_id = c.id
  left join lateral (
    -- The domain the company is DISPLAYED by (this page's picture):
    -- verified first, then the directory's most confident hint, the
    -- same ordering search_companies and get_user_company use.
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as domain_row on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('domain', d.domain, 'verified_at', d.verified_at)
      order by d.created_at asc
    ) as rows
    from public.company_domains as d
    where d.company_id = c.id and d.verified
  ) as domains on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('name', u.name, 'avatar_url', p.avatar_url, 'joined_at', m2.joined_at)
      order by m2.joined_at desc
    ) as rows
    from (
      select m2.company_id, m2.user_id, m2.joined_at
      from public.company_members as m2
      where m2.company_id = c.id and m2.verified
      order by m2.joined_at desc
      limit 8
    ) as m2
    join public.users as u on u.id = m2.user_id
    left join public.designer_profiles as p on p.user_id = m2.user_id
  ) as members on true
  where c.slug = lower(btrim(p_slug))
  group by c.id, c.name, c.slug, c.logo_url, domain_row.domain, c.is_active, c.created_at, domains.rows, members.rows;
$$;

comment on function public.get_company_page(text) is
  'Public company page payload: the display domain (verified when one exists, else the directory hint) that the picture resolves from, plus verified domains, verified member count and a recent-member preview. Never exposes member work emails.';

revoke all on function public.get_company_page(text) from public, anon, authenticated;
grant execute on function public.get_company_page(text) to service_role;
