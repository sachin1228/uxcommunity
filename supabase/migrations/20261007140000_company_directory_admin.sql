-- ============================================================
-- Migration: the company directory's admin operations
--
-- WHAT THIS ADDS
--   The two database functions the admin Companies page uses, so the picker's
--   directory and the admin page are the SAME two tables (public.companies and
--   public.company_domains) with no second source of truth:
--
--     admin_list_companies  — the list, with each company's primary domain,
--                             whether that domain is proved, its domain count
--                             and its verified member count, plus the match
--                             total for pagination.
--     admin_create_company  — add a company and (optionally) its unverified
--                             domain hint, with the slug and the duplicate
--                             checks the app must not re-implement.
--
--   Edit, activate/deactivate and delete need no function: they are a single
--   UPDATE or DELETE the service-role route runs directly, and deleting a
--   company cascades its domains, memberships and challenges (see
--   20260929120000_company_verified_domains.sql).
--
-- WHY A FUNCTION FOR CREATE, NOT THE ROUTE
--   A slug has to be unique and a domain may be offered by only one company, and
--   both are enforced by the schema. Resolving them in SQL keeps the rules in
--   one place and lets the whole create be one transaction: a name that is
--   already taken cannot leave a half-made company behind.
--
-- A DOMAIN AN ADMIN ADDS IS A HINT
--   `verified` is written false, exactly like the directory seed. Only a member
--   who receives and returns a code makes a domain verified; an operator can
--   prepare a row, never a proof.
--
-- ACCESS
--   Both functions are SECURITY DEFINER, service-role only. The route calls
--   them after `requireSession("admin")`, so an unprivileged session never
--   reaches them.
-- ============================================================


-- ─── List ───────────────────────────────────────────────────

create or replace function public.admin_list_companies(
  p_query  text default '',
  p_all    boolean default false,
  p_limit  integer default 200,
  p_offset integer default 0
)
returns table (
  id              uuid,
  name            text,
  slug            text,
  logo_url        text,
  is_active       boolean,
  created_at      timestamptz,
  domain          text,
  domain_verified boolean,
  domain_count    integer,
  member_count    bigint,
  total_count     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select
      c.id,
      c.name,
      c.slug,
      c.logo_url,
      c.is_active,
      c.created_at,
      (select count(*)::integer from public.company_domains as d
        where d.company_id = c.id) as domain_count,
      (select count(*)::bigint from public.company_members as m
        where m.company_id = c.id and m.verified) as member_count
    from public.companies as c
    where (p_all or c.is_active)
      and (
        btrim(coalesce(p_query, '')) = ''
        or c.name ilike '%' || public.company_search_term(p_query) || '%' escape '\'
        or c.slug ilike '%' || lower(public.company_search_term(p_query)) || '%' escape '\'
      )
  )
  select
    f.id,
    f.name,
    f.slug,
    f.logo_url,
    f.is_active,
    f.created_at,
    dom.domain,
    coalesce(dom.verified, false) as domain_verified,
    f.domain_count,
    f.member_count,
    count(*) over() as total_count
  from filtered as f
  -- The primary domain: a proved one first, then the oldest hint. This is the
  -- same order the picker's search uses, so a row reads the same in both places.
  left join lateral (
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = f.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as dom on true
  order by f.name asc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.admin_list_companies(text, boolean, integer, integer) is
  'Admin company directory page: each company with its primary domain, proof flag, domain count and verified member count, plus the match total. Search is by name or slug. Service-role only.';

revoke all on function public.admin_list_companies(text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_companies(text, boolean, integer, integer) to service_role;


-- ─── Create ─────────────────────────────────────────────────

create or replace function public.admin_create_company(
  p_name     text,
  p_domain   text default null,
  p_logo_url text default null
)
returns table (
  id         uuid,
  name       text,
  slug       text,
  logo_url   text,
  is_active  boolean,
  domain     text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name            text := nullif(btrim(coalesce(p_name, '')), '');
  v_domain          text := nullif(lower(btrim(coalesce(p_domain, ''))), '');
  v_slug_base       text;
  v_slug            text;
  v_suffix          integer := 1;
  v_company_id      uuid;
  v_existing_id     uuid;
  v_existing_active boolean;
  v_owner_id        uuid;
  v_owner_name      text;
begin
  if v_name is null or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'company_name_required';
  end if;

  if v_domain is not null
     and v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  -- A name already in the directory has to be edited, not duplicated. Detail
  -- carries the row and whether it is inactive, so the page can offer to
  -- reactivate it instead of failing flatly.
  select c.id, c.is_active into v_existing_id, v_existing_active
  from public.companies as c
  where lower(btrim(c.name)) = lower(v_name)
  limit 1;

  if v_existing_id is not null then
    raise exception using errcode = 'P0001', message = 'company_name_taken',
      detail = jsonb_build_object(
        'company_id', v_existing_id,
        'is_active', v_existing_active
      )::text;
  end if;

  -- A domain may belong to only one company, proved or hinted. Refuse rather
  -- than create a competing row, and name the owner so the page can say who.
  if v_domain is not null then
    select d.company_id, c.name into v_owner_id, v_owner_name
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id
    where d.domain = v_domain
    order by d.verified desc, d.created_at asc
    limit 1;
  end if;

  if v_owner_id is not null then
    raise exception using errcode = 'P0001', message = 'domain_taken',
      detail = jsonb_build_object(
        'company_id', v_owner_id,
        'company_name', v_owner_name
      )::text;
  end if;

  v_slug_base := left(public.company_slugify(v_name), 48);
  v_slug := v_slug_base;
  while exists (select 1 from public.companies as c where c.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  end loop;

  insert into public.companies (name, slug, logo_url, source, entity_status)
  values (v_name, v_slug, nullif(btrim(coalesce(p_logo_url, '')), ''), 'admin', 'active')
  returning public.companies.id into v_company_id;

  -- An operator prepares a hint; `verified` stays false. The first member whose
  -- work email matches finishes the claim through the ordinary OTP flow.
  if v_domain is not null then
    insert into public.company_domains (
      company_id, domain, verified, domain_type, evidence_confidence, source
    ) values (
      v_company_id, v_domain, false, 'primary_website', 'unknown', 'admin'
    );
  end if;

  return query
  select c.id, c.name, c.slug, c.logo_url, c.is_active, v_domain
  from public.companies as c
  where c.id = v_company_id;
end;
$$;

comment on function public.admin_create_company(text, text, text) is
  'Adds a company (unique slug from company_slugify, duplicate name refused) and, when given, one UNVERIFIED domain hint. verified is never written. Service-role only.';

revoke all on function public.admin_create_company(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_company(text, text, text) to service_role;


-- ─── Update and delete ──────────────────────────────────────

-- Rename, activate/deactivate, or set a logo. A null argument leaves that
-- field alone. Renaming is refused when the new name is another company's, so
-- the directory cannot grow two rows a person cannot tell apart.
create or replace function public.admin_update_company(
  p_id       uuid,
  p_name     text default null,
  p_is_active boolean default null,
  p_logo_url text default null
)
returns table (
  id        uuid,
  name      text,
  slug      text,
  logo_url  text,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := nullif(btrim(coalesce(p_name, '')), '');
  v_existing uuid;
begin
  if not exists (select 1 from public.companies as c where c.id = p_id) then
    raise exception using errcode = 'P0002', message = 'company_not_found';
  end if;

  if p_name is not null then
    if v_name is null or char_length(v_name) > 120 then
      raise exception using errcode = '22023', message = 'company_name_required';
    end if;

    select c.id into v_existing
    from public.companies as c
    where lower(btrim(c.name)) = lower(v_name) and c.id <> p_id
    limit 1;

    if v_existing is not null then
      raise exception using errcode = 'P0001', message = 'company_name_taken';
    end if;
  end if;

  update public.companies as c
  set name      = coalesce(v_name, c.name),
      is_active = coalesce(p_is_active, c.is_active),
      logo_url  = coalesce(nullif(btrim(coalesce(p_logo_url, '')), ''), c.logo_url)
  where c.id = p_id;

  return query
  select c.id, c.name, c.slug, c.logo_url, c.is_active
  from public.companies as c
  where c.id = p_id;
end;
$$;

comment on function public.admin_update_company(uuid, text, boolean, text) is
  'Renames or activates/deactivates a company (a null argument leaves the field alone). A name another company already holds is refused. Service-role only.';

revoke all on function public.admin_update_company(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_update_company(uuid, text, boolean, text) to service_role;


-- Deleting a company cascades its domains, memberships and challenges, and
-- clears any profile pointer at it (see the foreign keys in
-- 20260929120000_company_verified_domains.sql). That is exactly "remove it from
-- the work field"; returns false when there was nothing to delete.
create or replace function public.admin_delete_company(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found uuid;
begin
  select c.id into v_found from public.companies as c where c.id = p_id;
  if v_found is null then
    return false;
  end if;

  delete from public.companies as c where c.id = p_id;
  return true;
end;
$$;

comment on function public.admin_delete_company(uuid) is
  'Removes a company and, by cascade, its domains, memberships and pending challenges. Returns false when the row did not exist. Service-role only.';

revoke all on function public.admin_delete_company(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_company(uuid) to service_role;
