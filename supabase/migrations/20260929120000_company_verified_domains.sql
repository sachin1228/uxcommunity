-- ============================================================
-- Migration: Work / company on the profile, built on verified domains
--
-- WHAT THIS ADDS
--   * public.companies                      — one row per real company.
--   * public.company_domains                — a company's email domains.
--                                             1 → many, because a company
--                                             can own microsoft.com AND
--                                             microsoftonline.com.
--   * public.company_members                — who has proven a work email
--                                             on one of that company's
--                                             domains.
--   * public.company_email_verifications    — the pending "prove you control
--                                             this mailbox" challenge (OTP).
--
--   * designer_profiles.company_id          — the company the member shows on
--                                             their profile. A profile column
--                                             is a pointer, not the source of
--                                             truth: membership lives in
--                                             company_members, so a member can
--                                             belong to several companies and
--                                             pick which one to display.
--
-- THE TRUST MODEL (read this before changing the RPCs)
--   The verified DOMAIN is the trust signal, never the company name the
--   member typed. A member proves they control a mailbox on a domain; the
--   domain is what maps to a company. So:
--
--     * sachin@figma.com   + name "Figma"      → creates Figma / figma.com ✓
--     * sachin@figma.com   + name "Google"     → joins Figma (domain wins)
--     * sachin@randomco.com + name "Google"    → rejected: randomco.com is
--                                                not a verified Google domain
--     * sachin@gmail.com                       → rejected: free email domain
--
--   Verification means exactly one thing: "this member controls a work email
--   on this domain". It does NOT make them an admin or representative of the
--   company, and nothing here grants company-level privileges. A separate
--   company-admin / organisation verification feature is future work.
--
-- WHERE THE RULES LIVE
--   Every state-changing rule is enforced in the database functions below,
--   not in the API route:
--
--     start_company_verification    — joins/creates, domain lookups, the
--                                     personal-domain rule, retiring the
--                                     member's previous challenge.
--     confirm_company_verification  — the atomic commit: create the company,
--                                     claim the domain, create the membership,
--                                     point the profile at it.
--
--   The API route supplies the session's user id, never a company id or domain
--   it looked up itself, so a client cannot claim a company by posting an id.
--   The only client-supplied identity is the requested company_id / name, and
--   both are re-validated against company_domains here.
--
--   The free/personal email list is deliberately NOT stored in this migration:
--   it is policy that changes over time, and a migration is immutable history.
--   The single source of truth is apps/web/lib/companies/domains.ts, which the
--   route (server) and the picker UI both import.
--
-- COMPANY LOGOS
--   logo_url is set out of band (upload or a later resolution step from the
--   verified domain). It is never accepted as proof of ownership.
--
-- WRITE ACCESS
--   Every table here is read and written only by API routes through the
--   service-role client. RLS is on and anon/authenticated are revoked, so the
--   Data API can neither read a member's work email nor claim a domain.
-- ============================================================


-- ─── Companies ──────────────────────────────────────────────

create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  logo_url   text,
  created_by uuid references public.users (id) on delete set null,
  -- Deactivating hides a company from search and closes new memberships
  -- without deleting the memberships already proven on its domains.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companies_name on public.companies (lower(name));

create or replace trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();


-- ─── Company domains (1 company → many domains) ─────────────

create table if not exists public.company_domains (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  -- Stored already normalised, so every lookup is an index hit and two
  -- spellings of the same domain can never become two rows.
  domain      text not null check (
                domain = lower(btrim(domain))
                and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
              ),
  verified    boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  -- The same company cannot list a domain twice.
  constraint company_domains_company_domain_key unique (company_id, domain),
  -- verified_at is the timestamp the proof happened; a verified row always
  -- has one, an unverified row never claims to.
  constraint company_domains_verified_at_check check (
    (verified and verified_at is not null) or (not verified and verified_at is null)
  )
);

-- One verified owner per domain. The index is PARTIAL on purpose: an
-- unverified row (a domain an admin is preparing, or a claim that failed
-- before this feature only ever inserted verified rows) must not be able to
-- squat the domain and lock the real company out of it forever.
create unique index if not exists company_domains_verified_domain_idx
  on public.company_domains (domain) where verified;

create index if not exists idx_company_domains_company
  on public.company_domains (company_id);


-- ─── Memberships ────────────────────────────────────────────

create table if not exists public.company_members (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  verified   boolean not null default false,
  joined_at  timestamptz not null default now(),
  constraint company_members_company_user_key unique (company_id, user_id)
);

create index if not exists idx_company_members_user
  on public.company_members (user_id);
create index if not exists idx_company_members_company
  on public.company_members (company_id);


-- ─── Pending work-email challenges (OTP) ────────────────────

create table if not exists public.company_email_verifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  -- Null while the claim is "create a new company": the company row is only
  -- created once the member proves the domain, so an abandoned claim cannot
  -- leave half-made companies behind.
  company_id   uuid references public.companies (id) on delete cascade,
  company_name text not null check (char_length(btrim(company_name)) between 1 and 120),
  domain       text not null,
  -- The work email the code was sent to. Never shown publicly, and never
  -- returned to anyone but the member who started the challenge.
  work_email   text not null,
  -- sha256 of the one-time code (see apps/web/lib/companies/codes.ts). The
  -- code itself is never stored.
  code_hash    text not null,
  attempts     integer not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_company_email_verifications_user
  on public.company_email_verifications (user_id) where consumed_at is null;
create index if not exists idx_company_email_verifications_domain
  on public.company_email_verifications (domain) where consumed_at is null;


-- ─── The company a profile shows ────────────────────────────

-- ON DELETE SET NULL: deleting a company must not delete the member's profile.
alter table public.designer_profiles
  add column if not exists company_id uuid references public.companies (id) on delete set null;

create index if not exists idx_profiles_company
  on public.designer_profiles (company_id);


-- ─── Access ─────────────────────────────────────────────────

alter table public.companies                     enable row level security;
alter table public.company_domains               enable row level security;
alter table public.company_members               enable row level security;
alter table public.company_email_verifications   enable row level security;

-- No policies: default-deny for anon/authenticated. The server routes use the
-- service-role client, which bypasses RLS. Revoking the table grants as well
-- means a permissive policy added later still would not open the table.
revoke all on table public.companies                   from anon, authenticated;
revoke all on table public.company_domains             from anon, authenticated;
revoke all on table public.company_members             from anon, authenticated;
revoke all on table public.company_email_verifications from anon, authenticated;


-- ─── Helpers ────────────────────────────────────────────────

-- "Acme & Sons Pvt. Ltd." → "acme-sons-pvt-ltd". Only ever called through the
-- RPCs, so a stable slug is guaranteed even when the name is all punctuation.
create or replace function public.company_slugify(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      left(trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g')), 60),
      ''
    ),
    'company'
  );
$$;

comment on function public.company_slugify(text) is
  'URL slug for a company name. Falls back to ''company'' when the name has no alphanumeric characters.';


-- Escapes the LIKE wildcards in a search term so a member typing "%" searches
-- for a literal percent sign instead of matching every company.
create or replace function public.company_search_term(p_query text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_');
$$;


-- The verified owner of a domain, or null when nobody has proven it yet.
-- This is the lookup the app uses to answer "which company is this domain?".
create or replace function public.company_domain_owner(p_domain text)
returns table (
  company_id uuid,
  name       text,
  slug       text,
  verified   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.slug, d.verified
  from public.company_domains as d
  join public.companies as c on c.id = d.company_id
  where d.domain = lower(btrim(p_domain))
  order by d.verified desc, d.created_at asc
  limit 1;
$$;

comment on function public.company_domain_owner(text) is
  'Returns the company a normalised domain maps to. Prefers a verified owner; used to route a member to the right company instead of matching on the typed company name.';


-- ─── Search ─────────────────────────────────────────────────

-- Directory search for the "Where do you work?" picker. Matches a company by
-- name, slug, or verified domain, so typing "figma.com" finds Figma too.
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
    domain_row.domain is not null as verified,
    (select count(*) from public.company_members as m
      where m.company_id = c.id and m.verified) as member_count
  from public.companies as c
  left join lateral (
    select d.domain
    from public.company_domains as d
    where d.company_id = c.id and d.verified
    order by d.created_at asc, d.domain asc
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
    c.name asc
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;

comment on function public.search_companies(text, integer) is
  'Active-company directory search by name, slug or verified domain, with the primary verified domain and verified member count.';


-- ─── Read models ────────────────────────────────────────────

-- The company a profile shows: the pointer on designer_profiles joined to the
-- company, its primary verified domain and the member's own membership row.
create or replace function public.get_user_company(p_user_id uuid)
returns table (
  company_id         uuid,
  name               text,
  slug               text,
  logo_url           text,
  is_active          boolean,
  domain             text,
  domain_verified    boolean,
  membership_verified boolean,
  joined_at          timestamptz
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
    c.is_active,
    domain_row.domain,
    coalesce(domain_row.domain is not null, false),
    coalesce(m.verified, false),
    m.joined_at
  from public.designer_profiles as dp
  join public.companies as c on c.id = dp.company_id
  left join public.company_members as m
    on m.company_id = c.id and m.user_id = dp.user_id
  left join lateral (
    select d.domain
    from public.company_domains as d
    where d.company_id = c.id and d.verified
    order by d.created_at asc, d.domain asc
    limit 1
  ) as domain_row on true
  where dp.user_id = p_user_id
  limit 1;
$$;

comment on function public.get_user_company(uuid) is
  'The company a member displays on their profile, with its primary verified domain and the member''s own verified membership flag.';


-- The member's work-email challenge, so the picker can reopen straight into
-- "we emailed you a code" after a reload or on another device.
--
-- Without p_verification_id it returns only a live challenge (unconsumed and
-- unexpired), which is what the picker renders. With it, it returns that
-- member's row whatever state it is in: a resend needs the work email the code
-- was sent to, and after a page reload the browser no longer has it, so the
-- server has to read it back from the challenge it issued.
create or replace function public.get_pending_company_verification(
  p_user_id uuid,
  p_verification_id uuid default null
)
returns table (
  verification_id uuid,
  company_id      uuid,
  company_name    text,
  domain          text,
  work_email      text,
  attempts_left   integer,
  expires_at      timestamptz,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id,
    v.company_id,
    v.company_name,
    v.domain,
    v.work_email,
    greatest(5 - v.attempts, 0),
    v.expires_at,
    v.created_at
  from public.company_email_verifications as v
  where v.user_id = p_user_id
    and case
      when p_verification_id is null then v.consumed_at is null and v.expires_at > now()
      else v.id = p_verification_id
    end
  order by v.created_at desc
  limit 1;
$$;


-- The company page: header data, every verified domain, verified member count
-- and a preview of recent members.
create or replace function public.get_company_page(p_slug text)
returns table (
  id           uuid,
  name         text,
  slug         text,
  logo_url     text,
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
    c.is_active,
    c.created_at,
    count(distinct m.user_id) filter (where m.verified) as member_count,
    coalesce(domains.rows, '[]'::jsonb),
    coalesce(members.rows, '[]'::jsonb)
  from public.companies as c
  left join public.company_members as m on m.company_id = c.id
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
  group by c.id, c.name, c.slug, c.logo_url, c.is_active, c.created_at, domains.rows, members.rows;
$$;

comment on function public.get_company_page(text) is
  'Public company page payload: verified domains, verified member count and a recent-member preview. Never exposes member work emails.';


-- ─── Start a challenge ──────────────────────────────────────

-- Called by the API route with the session user id and everything the member
-- chose. Every rule is re-checked here against company_domains; the requested
-- company id or name is never trusted on its own.
--
-- Outcomes that are part of normal UX are raised as exceptions with a stable
-- message so the route can map them onto a status code:
--   domain_already_verified        → the domain belongs to a company already
--                                    (detail carries its id and name)
--   domain_not_verified_for_company → joining a company whose domain is not
--                                    one of its verified domains
--   company_name_taken             → the typed name already exists as a
--                                    company; it has to be joined instead
--   already_member                 → the member already proved this company
--   company_inactive               → the requested company is deactivated
--   invalid_domain                 → domain was not normalised/rejected
--   company_name_required          → creating without a name
--   unknown_user                   → session user no longer exists
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
  v_domain         text := lower(btrim(coalesce(p_domain, '')));
  v_email          text := lower(btrim(coalesce(p_work_email, '')));
  v_company_id     uuid := p_company_id;
  v_company_name   text;
  v_owner_id       uuid;
  v_owner_name     text;
  v_name_match_id  uuid;
  v_name_match_name text;
  v_verification_id uuid;
  v_expires_at     timestamptz := now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 5));
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

    -- The domain is what grants access to the company, not the name. A member
    -- selecting "Google" with an unrelated work email lands here.
    if not exists (
      select 1 from public.company_domains as d
      where d.company_id = v_company_id and d.domain = v_domain and d.verified
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
        detail = jsonb_build_object('company_id', v_owner_id, 'company_name', v_owner_name)::text;
    end if;

    -- Anti-impersonation: an existing company name cannot be re-created under
    -- a domain that company does not own. Without this, "Google" + a work
    -- email on some unrelated domain would put the word Google on a profile
    -- as a brand-new company. The existing company has to be joined, and
    -- joining only works with one of ITS verified domains.
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
  'Opens a work-email challenge. Resolves the company from the verified domain, never from the typed name, and retires the member''s previous challenge.';


-- ─── Confirm a challenge (the atomic commit) ────────────────

-- Everything that makes a membership real happens in this one transaction:
-- the company row (when creating), the verified domain claim, the membership
-- and the profile pointer. Expected outcomes are returned as a status rather
-- than raised, because a failed code has to persist its attempt counter — an
-- exception would roll that increment back.
--
-- The domain claim is the race boundary: a bare `on conflict do nothing`
-- swallows the partial unique index hit, and raising there rolls back the
-- company row created a moment earlier so two racing members cannot both
-- create Figma.
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
      -- The domain stopped being verified for this company between the
      -- challenge and the confirmation (deactivated or reassigned).
      return query select 'domain_not_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz;
      return;
    end if;
  else
    -- Creating a company from the name typed when the challenge started.
    if v_owner_id is not null then
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
  'Commits a proved work email: creates or resolves the company, claims the verified domain, records the membership and points the profile at it — all in one transaction.';


-- ─── Leave ──────────────────────────────────────────────────

-- Removes the member from the company their profile shows. The membership row
-- goes away; the company and its verified domain stay.
create or replace function public.leave_company(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  select dp.company_id into v_company_id
  from public.designer_profiles as dp
  where dp.user_id = p_user_id
  for update;

  if v_company_id is null then
    return false;
  end if;

  delete from public.company_members as m
  where m.user_id = p_user_id and m.company_id = v_company_id;

  update public.designer_profiles as dp
  set company_id = null, updated_at = now()
  where dp.user_id = p_user_id;

  return true;
end;
$$;


-- ─── Execute grants ─────────────────────────────────────────

revoke all on function public.company_slugify(text) from public, anon, authenticated;
grant execute on function public.company_slugify(text) to service_role;

revoke all on function public.company_search_term(text) from public, anon, authenticated;
grant execute on function public.company_search_term(text) to service_role;

revoke all on function public.company_domain_owner(text) from public, anon, authenticated;
grant execute on function public.company_domain_owner(text) to service_role;

revoke all on function public.search_companies(text, integer) from public, anon, authenticated;
grant execute on function public.search_companies(text, integer) to service_role;

revoke all on function public.get_user_company(uuid) from public, anon, authenticated;
grant execute on function public.get_user_company(uuid) to service_role;

revoke all on function public.get_pending_company_verification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_pending_company_verification(uuid, uuid) to service_role;

revoke all on function public.get_company_page(text) from public, anon, authenticated;
grant execute on function public.get_company_page(text) to service_role;

revoke all on function public.start_company_verification(uuid, text, text, text, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.start_company_verification(uuid, text, text, text, uuid, text, integer)
  to service_role;

revoke all on function public.confirm_company_verification(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_company_verification(uuid, uuid, text) to service_role;

revoke all on function public.leave_company(uuid) from public, anon, authenticated;
grant execute on function public.leave_company(uuid) to service_role;
