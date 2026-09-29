-- ============================================================
-- Migration: A domain hint is not a verified claim
--
-- WHAT THIS CHANGES
--   Adds a third state to `company_domains`, the one the default company
--   directory (20260929140000_company_directory.sql) writes:
--
--     verified = true   a member proved a work email on this domain
--     verified = false  a KNOWN domain that nobody has proved yet — a hint
--     (no row)          the company has never claimed this domain
--
--   The three RPCs below learn what a hint means. Nothing else about the
--   model moves, and no table or column is added.
--
-- WHY (the dead end this closes)
--   A directory entry with no domain is worse than no entry at all. Seeding
--   names alone means the first member whose employer is in the directory
--   types their real company and hits both rails at once:
--
--     * creating the company is refused with `company_name_taken`, because
--       the name already exists, and
--     * joining it is refused with `domain_not_verified_for_company`, because
--       the company has no verified domain for their work email to match.
--
--   So the two paths a member could take are closed by the entry that claims
--   to be their company. With a hint, the second path opens: the domain is
--   known, the work email is the proof, and the member's confirmation is what
--   turns the hint into a verified claim.
--
-- WHAT DOES *NOT* CHANGE
--   The trust model. A hint is not a claim, and proving is still the only
--   thing that verifies a domain:
--
--     * `search_companies` reports a hint as the company's known domain but
--       leaves `verified` false, and a hint never matches a domain search —
--       an unproven row still owns nothing.
--     * `company_domain_owner` is untouched and still prefers verified rows,
--       so routing a work email to a company never follows a hint.
--     * the partial unique index `company_domains_verified_domain_idx` is
--       still the race boundary, so only one company can end up owning a
--       domain and a bad hint loses to whoever proves it first.
--     * the first member to prove a hinted domain STILL has to receive and
--       enter the code, so nothing here lets an unproved mailbox join.
--
-- WHERE THE HINT COMES FROM
--   Only a migration or an operator can write an unverified row: every write
--   path a member has (`start_company_verification`,
--   `confirm_company_verification`) either inserts a VERIFIED row or promotes
--   an existing hint, so this migration cannot be used to plant a claim
--   through the API. The refusals that name a company (see `refusedCompany` in
--   apps/web/lib/companies/service.ts) are what turn a domain whose hint
--   belongs to somebody else into "join that one instead" rather than a wall.
-- ============================================================


-- ─── Start a challenge ──────────────────────────────────────

-- Unchanged except for the domain rule, which now accepts a hint:
--   domain_not_verified_for_company → joining a company that has never listed
--                                     the domain at all (a hint is enough to
--                                     start; the code still has to come back)
--   domain_already_verified         → the domain is taken, or already mapped
--                                     to a company by the directory; `reason`
--                                     in the detail says which
create or replace function public.start_company_verification(
  p_user_id      uuid,
  p_domain       text,
  p_work_email   text,
  p_code_hash    text,
  p_company_id   uuid default null,
  p_company_name text default null,
  p_ttl_minutes  integer default 30
)
returns table (
  verification_id uuid,
  company_id      uuid,
  company_name    text,
  domain          text,
  work_email      text,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain          text := lower(btrim(coalesce(p_domain, '')));
  v_email           text := lower(btrim(coalesce(p_work_email, '')));
  v_company_id      uuid := p_company_id;
  v_company_name    text;
  v_owner_id        uuid;
  v_owner_name      text;
  v_hint_id         uuid;
  v_hint_name       text;
  v_name_match_id   uuid;
  v_name_match_name text;
  v_verification_id uuid;
  v_expires_at      timestamptz := now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 5));
begin
  if p_user_id is null or not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;

  -- The route always passes an already-normalised domain, so a mismatch means
  -- the value was not normalised (a bypass) and is rejected outright.
  if v_domain = ''
     or v_domain <> p_domain
     or v_domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception using errcode = '22023', message = 'invalid_work_email';
  end if;

  if split_part(v_email, '@', 2) <> v_domain then
    raise exception using errcode = '22023', message = 'email_domain_mismatch';
  end if;

  if v_company_id is not null then
    -- Joining an existing company.
    select c.name into v_company_name
    from public.companies as c
    where c.id = v_company_id and c.is_active;

    if v_company_name is null then
      raise exception using errcode = 'P0001', message = 'company_inactive';
    end if;

    -- The domain is what grants access to the company, not the name: a member
    -- selecting "Google" with a work email on an unrelated domain lands here.
    -- A directory hint counts, because the code still has to come back to
    -- prove the mailbox; a domain the company never listed is not a claim the
    -- member can open at all.
    if not exists (
      select 1 from public.company_domains as d
      where d.company_id = v_company_id and d.domain = v_domain
    ) then
      raise exception using errcode = 'P0001', message = 'domain_not_verified_for_company';
    end if;

    if exists (
      select 1 from public.company_members as m
      where m.company_id = v_company_id and m.user_id = p_user_id and m.verified
    ) then
      raise exception using errcode = 'P0001', message = 'already_member';
    end if;
  else
    -- Creating a company. The name is a label for the domain the member is
    -- about to prove; if the domain is already verified, they must join that
    -- company instead of minting a duplicate from the typed name.
    v_company_name := nullif(btrim(coalesce(p_company_name, '')), '');
    if v_company_name is null then
      raise exception using errcode = '22023', message = 'company_name_required';
    end if;

    select d.company_id into v_owner_id
    from public.company_domains as d
    where d.domain = v_domain and d.verified
    limit 1;

    if v_owner_id is not null then
      select c.name into v_owner_name from public.companies as c where c.id = v_owner_id;
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_owner_id,
          'company_name', v_owner_name,
          'reason', 'verified'
        )::text;
    end if;

    -- The domain is already known as somebody's directory entry. Proving it
    -- under a new name would create a second company for a domain that
    -- already represents one, so the member joins that company — where the
    -- very same work email can finish the claim — instead of naming a
    -- duplicate. Same message as above (the member's action is identical) with
    -- a detail that says the mapping is reserved rather than proved.
    select d.company_id into v_hint_id
    from public.company_domains as d
    join public.companies as hc on hc.id = d.company_id and hc.is_active
    where d.domain = v_domain and not d.verified
    order by d.created_at asc, d.domain asc
    limit 1;

    if v_hint_id is not null then
      select c.name into v_hint_name from public.companies as c where c.id = v_hint_id;
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_hint_id,
          'company_name', v_hint_name,
          'reason', 'reserved'
        )::text;
    end if;

    -- Anti-impersonation: an existing company name cannot be re-created under
    -- a domain that company does not own. Without this, "Google" + a work
    -- email on some unrelated domain would put the word Google on a profile
    -- as a brand-new company. The existing company has to be joined, and
    -- joining only works with one of ITS domains.
    select c.id, c.name into v_name_match_id, v_name_match_name
    from public.companies as c
    where c.is_active and lower(btrim(c.name)) = lower(v_company_name)
    limit 1;

    if v_name_match_id is not null then
      raise exception using errcode = 'P0001', message = 'company_name_taken',
        detail = jsonb_build_object(
          'company_id', v_name_match_id,
          'company_name', v_name_match_name
        )::text;
    end if;
  end if;

  -- One live challenge per member: starting again retires the previous code so
  -- an old email can never be replayed after a resend.
  update public.company_email_verifications as v
  set consumed_at = now()
  where v.user_id = p_user_id and v.consumed_at is null;

  insert into public.company_email_verifications (
    user_id, company_id, company_name, domain, work_email, code_hash, expires_at
  ) values (
    p_user_id, v_company_id, v_company_name, v_domain, v_email, p_code_hash, v_expires_at
  )
  returning id into v_verification_id;

  return query
  select v_verification_id, v_company_id, v_company_name, v_domain, v_email, v_expires_at;
end;
$$;

comment on function public.start_company_verification(uuid, text, text, text, uuid, text, integer) is
  'Opens a work-email challenge. Resolves the company from the domain, never from the typed name, and accepts a directory hint as long as the code is what has to come back.';


-- ─── Confirm a challenge (the atomic commit) ────────────────

-- Adding a company is unchanged. Joining one gains a step: when the domain is
-- nobody's verified domain yet but is one of THE COMPANY'S OWN hints, this
-- confirmation promotes that hint instead of rejecting the member. The update
-- is where the race is decided, because it is the row the partial unique index
-- guards — a concurrent proof by another company raises `unique_violation`,
-- which is caught (it must not roll back the member's challenge) and answered
-- with `domain_already_verified` so the member joins that company instead.
create or replace function public.confirm_company_verification(
  p_user_id         uuid,
  p_verification_id uuid,
  p_code_hash       text
)
returns table (
  status           text,
  attempts_left    integer,
  company_id       uuid,
  company_name     text,
  company_slug     text,
  company_logo_url text,
  domain           text,
  joined_at        timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row           public.company_email_verifications;
  v_company_id    uuid;
  v_company_name  text;
  v_company_slug  text;
  v_logo_url      text;
  v_slug_base     text;
  v_slug          text;
  v_suffix        integer := 1;
  v_domain_row_id uuid;
  v_joined_at     timestamptz;
  v_owner_id      uuid;
  v_hint_id       uuid;
  v_attempts      integer;
begin
  select * into v_row
  from public.company_email_verifications as v
  where v.id = p_verification_id and v.user_id = p_user_id
  for update;

  if v_row.id is null then
    return query select 'not_found'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.consumed_at is not null then
    return query select 'already_used'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_attempts := v_row.attempts;

  if v_attempts >= 5 then
    return query select 'too_many_attempts'::text, 0, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.code_hash is distinct from p_code_hash then
    update public.company_email_verifications as v
    set attempts = v.attempts + 1
    where v.id = v_row.id
    returning v.attempts into v_attempts;

    -- The last wrong guess burns the challenge: the route sends the member
    -- back to the start, which also invalidates the emailed code.
    if v_attempts >= 5 then
      update public.company_email_verifications as v
      set consumed_at = now()
      where v.id = v_row.id;
    end if;

    return query select 'invalid_code'::text, greatest(5 - v_attempts, 0), null::uuid,
      null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Is the domain already someone's verified domain?
  select d.company_id into v_owner_id
  from public.company_domains as d
  where d.domain = v_row.domain and d.verified
  limit 1;

  if v_row.company_id is not null then
    -- Joining an existing company.
    select c.id, c.name, c.slug, c.logo_url
      into v_company_id, v_company_name, v_company_slug, v_logo_url
    from public.companies as c
    where c.id = v_row.company_id and c.is_active;

    if v_company_id is null then
      return query select 'company_inactive'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz;
      return;
    end if;

    if v_owner_id is distinct from v_company_id then
      -- Nobody has proved this domain. The membership is only real if this
      -- company is the one the domain is known by (a directory hint planted
      -- for it): an unrelated company cannot absorb a domain a member happens
      -- to hold a mailbox on.
      if v_owner_id is not null or not exists (
        select 1 from public.company_domains as d
        where d.company_id = v_company_id and d.domain = v_row.domain and not d.verified
      ) then
        return query select 'domain_not_verified'::text, null::integer, null::uuid,
          null::text, null::text, null::text, null::text, null::timestamptz;
        return;
      end if;

      begin
        update public.company_domains as d
        set verified = true, verified_at = now()
        where d.company_id = v_company_id
          and d.domain = v_row.domain
          and not d.verified;
      exception when unique_violation then
        -- Another company proved this domain in the meantime. They own it;
        -- this member joins them instead. Caught rather than raised so the
        -- challenge below is not rolled back.
        return query select 'domain_already_verified'::text, null::integer, null::uuid,
          null::text, null::text, null::text, null::text, null::timestamptz;
        return;
      end;

      if not found then
        -- The hint was already promoted, or the domain moved. Whoever owns it
        -- now decides: this company means the member's claim is valid and
        -- another colleague won the promotion race, anybody else means they
        -- have to join that company.
        select d.company_id into v_owner_id
        from public.company_domains as d
        where d.domain = v_row.domain and d.verified
        limit 1;

        if v_owner_id is distinct from v_company_id then
          return query select 'domain_already_verified'::text, null::integer, null::uuid,
            null::text, null::text, null::text, null::text, null::timestamptz;
          return;
        end if;
      end if;
    end if;
  else
    -- Creating a company from the name typed when the challenge started.
    if v_owner_id is not null then
      return query select 'domain_already_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz;
      return;
    end if;

    -- A hint that appeared between the challenge and this confirmation (the
    -- directory being applied, or an operator preparing the entry) must not be
    -- spent on a second company for the same domain.
    select d.company_id into v_hint_id
    from public.company_domains as d
    join public.companies as hc on hc.id = d.company_id and hc.is_active
    where d.domain = v_row.domain and not d.verified
    order by d.created_at asc, d.domain asc
    limit 1;

    if v_hint_id is not null then
      return query select 'domain_already_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz;
      return;
    end if;

    v_slug_base := left(public.company_slugify(v_row.company_name), 48);
    v_slug := v_slug_base;
    while exists (select 1 from public.companies as c where c.slug = v_slug) loop
      v_suffix := v_suffix + 1;
      v_slug := v_slug_base || '-' || v_suffix;
    end loop;

    insert into public.companies (name, slug, created_by)
    values (v_row.company_name, v_slug, p_user_id)
    returning id, name, slug, logo_url
      into v_company_id, v_company_name, v_company_slug, v_logo_url;

    insert into public.company_domains (company_id, domain, verified, verified_at)
    values (v_company_id, v_row.domain, true, now())
    on conflict do nothing
    returning id into v_domain_row_id;

    if v_domain_row_id is null then
      -- Another member verified this domain in the meantime. Raising rolls
      -- back the company row inserted above, so no orphan duplicate is left.
      raise exception using errcode = 'P0001', message = 'domain_already_verified';
    end if;
  end if;

  -- Membership. An earlier unverified row for this pair is promoted, so a
  -- member who was recorded but never proven becomes verified here.
  -- Named constraint, not `on conflict (company_id, user_id)`: this function's
  -- OUT parameters include `company_id`, and PL/pgSQL resolves a conflict
  -- target column list against its variables, which makes the bare form
  -- ambiguous. For the same reason the timestamp is read back in its own
  -- statement rather than through `returning joined_at`.
  insert into public.company_members (company_id, user_id, verified, joined_at)
  values (v_company_id, p_user_id, true, now())
  on conflict on constraint company_members_company_user_key
    do update set verified = true, joined_at = now();

  select m.joined_at into v_joined_at
  from public.company_members as m
  where m.company_id = v_company_id and m.user_id = p_user_id;

  -- The profile pointer is separate from membership: this is which company the
  -- member displays, and it can be cleared again through leave_company().
  update public.designer_profiles as dp
  set company_id = v_company_id, updated_at = now()
  where dp.user_id = p_user_id;

  update public.company_email_verifications as v
  set consumed_at = now()
  where v.id = v_row.id;

  return query select 'verified'::text, null::integer, v_company_id, v_company_name,
    v_company_slug, v_logo_url, v_row.domain, v_joined_at;
end;
$$;

comment on function public.confirm_company_verification(uuid, uuid, text) is
  'Commits a proved work email: creates or resolves the company, claims the domain (promoting a directory hint when the company is the one the domain is known by), records the membership and points the profile at it — all in one transaction.';


-- ─── Directory search ───────────────────────────────────────

-- The picker now has something to show for a company nobody has proved yet:
-- the domain the directory knows it by, with `verified` still false. Only a
-- verified domain matches a domain search, so an unproven row still owns
-- nothing and cannot answer for a domain in its own name.
create or replace function public.search_companies(
  p_query text,
  p_limit integer default 10
)
returns table (
  id           uuid,
  name         text,
  slug         text,
  logo_url     text,
  domain       text,
  verified     boolean,
  member_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term text := public.company_search_term(p_query);
  v_like text;
begin
  -- An empty query browses the directory instead of returning nothing.
  v_like := case when v_term = '' then null else '%' || v_term || '%' end;

  return query
  select
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    domain_row.domain,
    coalesce(domain_row.verified, false),
    (select count(*) from public.company_members as m
      where m.company_id = c.id and m.verified) as member_count
  from public.companies as c
  left join lateral (
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc, d.created_at asc, d.domain asc
    limit 1
  ) as domain_row on true
  where c.is_active
    and (
      v_like is null
      or c.name ilike v_like escape '\'
      or c.slug ilike v_like escape '\'
      or exists (
        select 1 from public.company_domains as d
        where d.company_id = c.id
          and d.verified
          and d.domain ilike v_like escape '\'
      )
    )
  order by
    -- Names that start with what was typed rank above substring matches.
    (v_like is not null and c.name ilike (v_term || '%') escape '\') desc,
    -- A company somebody has proved outranks a bare directory entry, then
    -- names that start with the term, then the rest of the alphabet.
    (domain_row.verified) desc nulls last,
    c.name asc
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;

comment on function public.search_companies(text, integer) is
  'Active-company directory search by name, slug or verified domain. Reports the primary verified domain, or the directory domain for a company nobody has proved yet, which is where a logo comes from.';
