-- ============================================================
-- Migration: A domain is a claim with a steward, not a company's property
--
-- WHAT THIS CHANGES
--   `company_domains` stops being "the list of domains a company owns" and
--   becomes a CLAIM: one row per (company, domain), carrying the kind of
--   domain it is, how strong the evidence behind it is, and where that
--   evidence came from. On top of claims:
--
--     claims        0..N companies may claim one domain. An unverified claim is
--                   EVIDENCE, so two companies disagreeing is a state the data
--                   model has to be able to hold — the old draft's partial
--                   unique index on unverified rows is NOT created here.
--     steward       0..1 company per domain, RESOLVED from the claims rather
--                   than constrained: a proof wins, otherwise the strongest
--                   claim, otherwise the domain is contested and says so.
--     verified      0..1 company per domain. This is the only uniqueness
--                   boundary, and it is the existing partial unique index
--                   `company_domains_verified_domain_idx`. A proof is still the
--                   only thing that sets it.
--     delegation    0..N explicit, reviewed statements that "this entity's
--                   staff may prove a work email on a domain another entity
--                   stewards". It lives OUTSIDE the claim table on purpose: a
--                   delegation must never be able to create a second verified
--                   claim on a domain.
--
--   Also added, because the layers above need somewhere to put what they know:
--   `domain_evidence` (one row per OBSERVATION, each with its own URL), typed
--   `company_aliases`, `company_relationships` and `company_domains.domain_type`
--   so a marketing site is never mistaken for a mail domain.
--
-- WHY (the question this answers)
--   "official website domain" is not "employee email domain". Meta's website is
--   meta.com and WhatsApp's is whatsapp.com; whether Meta's staff may prove a
--   mailbox at whatsapp.com is a fact about WhatsApp, not a fact Meta inherits
--   by owning it. The rules this migration enforces, in one place:
--
--     * a company/subsidiary relationship NEVER transfers a domain and NEVER
--       creates a claim;
--     * a verified domain owned by another company is refused (case C), never
--       silently honoured — the member is offered the owner;
--     * only an explicit, REVIEWED delegation lets an entity verify on
--       another entity's domain (case F), and it leaves the steward untouched;
--     * MX records, redirects and string similarity are evidence at best. None
--       of them is implemented here as proof of anything;
--     * a weak (low/unknown-confidence) claim never blocks a real company from
--       being created and never pre-selects a company for a member (case H).
--       The directory seed lists ~4,574 domains at confidence `unknown`; at
--       scale those must not reserve a domain forever.
--
-- WHAT DOES NOT CHANGE
--   The trust model. A hint is not a claim on a mailbox, and a profile still
--   needs an OTP on a work email: `start_company_verification` opens a
--   challenge, `confirm_company_verification` is the only thing that sets
--   `verified = true`, membership is unchanged, and no dataset, delegation or
--   relationship can promote a domain on its own.
--
-- WHAT A PROOF IS ALLOWED TO ESTABLISH
--   A work-email OTP proves control of a MAILBOX. It does not prove that the
--   directory's mapping of that mailbox's domain to a company is right, and the
--   two are deliberately separated now:
--
--     * an OTP against a claim that is `high` or `medium` (reviewed evidence)
--       promotes the claim to verified, exactly as before — case B;
--     * an OTP against a `low`/`unknown` claim establishes DOMAIN CONTROL and
--       nothing else: the observation is recorded in `domain_evidence`, no
--       claim becomes verified, no membership is created, and the challenge
--       answers `domain_control_only` instead of `verified`.
--
--   Without that split, anyone with a mailbox at a domain the directory merely
--   GUESSED belongs to "Company A" could select Company A, prove the mailbox,
--   and hand the directory's wrong mapping the authority of a proof — which is
--   the one thing this model exists to prevent. A weak claim stays evidence; a
--   member who really works somewhere can always prove it for the company they
--   name themselves (case G/H), which is a claim about their own employer
--   rather than a guess about somebody else's.
--
-- ENTITY IDENTITY
--   `companies.source_id` + `source` + `jurisdiction` carry a registry's own
--   legal identifier (Companies House company_number in GB, an LEI, a Wikidata
--   QID), with a partial unique index on (source, source_id). A name is not an
--   identity: two companies with the same name in two jurisdictions are two
--   rows, and the internal UUID stays the stable handle for both.
--
-- APPLIED TO A DATABASE THAT ALREADY RAN THE DIRECTORY SEED
--   `20260929140000_company_directory.sql` already wrote one unverified row per
--   company. This migration adds the columns with defaults, so those rows
--   become `primary_website` / `unknown` claims. The backfill that attributes
--   their source lives in the next migration; nothing here reads or rewrites
--   their `verified` flag.
--
-- ORDER
--   20260929120000 (tables) → 130000 (hints) → 140000 (directory seed) →
--   150000 (this file) → 151000 (backfill).
-- ============================================================


-- ─── Extensions ─────────────────────────────────────────────

-- `pg_trgm` is what makes a substring company search index-backed instead of a
-- sequential scan of the whole directory (see the search section at the bottom).
-- Installed into `extensions` explicitly so the operator class below can be
-- named as `extensions.gin_trgm_ops` regardless of the session's search_path,
-- and so this file behaves the same on Supabase (where the schema already
-- exists) and on a bare PostgreSQL (where it does not).
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;


-- ─── Companies: what the registry layers will fill in ───────

-- All nullable except `entity_status`: a backfill cannot invent a country, an
-- industry or a rank, and must not fail on a row that has none.
alter table public.companies
  add column if not exists country_code      text,
  add column if not exists industry          text,
  add column if not exists entity_status     text not null default 'unknown',
  add column if not exists source            text,
  add column if not exists source_id         text,
  add column if not exists jurisdiction      text,
  add column if not exists source_confidence text,
  add column if not exists directory_rank    integer,
  add column if not exists last_checked_at   timestamptz;

-- The legal identity of a registry row: the registry's OWN identifier for the
-- entity, not a name we derived. Partial, because a company a member created
-- has no registry id at all, and two of those must not conflict over "null".
create unique index if not exists companies_source_identity_idx
  on public.companies (source, source_id)
  where source_id is not null;

comment on column public.companies.source_id is
  'The source''s own identifier for this entity (Companies House company_number, an LEI, a Wikidata QID). With `source` it is the legal identity; the row''s UUID is the internal handle that never changes.';
comment on column public.companies.jurisdiction is
  'The registry jurisdiction the identity belongs to (GB, US-DE, …), which is what keeps two same-named companies in different countries two rows instead of one merge.';

alter table public.companies
  drop constraint if exists companies_entity_status_check,
  drop constraint if exists companies_source_confidence_check,
  add constraint companies_entity_status_check check (entity_status in (
    'active', 'inactive', 'dissolved', 'acquired', 'unknown'
  )),
  add constraint companies_source_confidence_check check (
    source_confidence is null or source_confidence in ('high', 'medium', 'low', 'unknown')
  );

comment on column public.companies.entity_status is
  'What the registry layers say about the entity: active, dissolved, acquired. Ordering and search read it; `unknown` is the honest default for a row nobody has checked.';
comment on column public.companies.directory_rank is
  'Deterministic order for the directory: evidence-bearing companies first, then confidence, then notability. A rank is a position in a list, NOT a company size.';
comment on column public.companies.source is
  'Which layer produced this row (curated, wikidata-p856, a registry id). Provenance, not an authority: nothing derives a verified domain from it.';


-- ─── company_domains: the CLAIM ─────────────────────────────

alter table public.company_domains
  add column if not exists domain_type         text not null default 'primary_website',
  add column if not exists evidence_confidence text not null default 'unknown',
  add column if not exists source              text,
  add column if not exists first_seen_at       timestamptz not null default now(),
  add column if not exists last_checked_at     timestamptz;

-- Constraints are dropped first, so this block can be applied on top of a
-- database that already ran an earlier draft of it.
alter table public.company_domains
  drop constraint if exists company_domains_domain_type_check,
  drop constraint if exists company_domains_confidence_check,
  add constraint company_domains_domain_type_check check (domain_type in (
    'primary_website', 'corporate_email', 'subsidiary_email',
    'brand', 'subsidiary', 'regional', 'historical', 'alias'
  )),
  add constraint company_domains_confidence_check check (evidence_confidence in (
    'high', 'medium', 'low', 'unknown'
  ));

-- Exact lookups have to work for unverified claims too, not only for the
-- verified row: today the only index on `domain` is partial on `verified`, so
-- resolving a claim sequential-scans the table (11 ms at 500k rows).
create index if not exists company_domains_domain_idx
  on public.company_domains (domain);

-- Prefix lookups ("figma.co") for the search rewrite. `text_pattern_ops` is
-- what makes `like 'figma%'` an index scan under a non-C collation.
create index if not exists company_domains_domain_prefix_idx
  on public.company_domains (domain text_pattern_ops);

comment on column public.company_domains.domain_type is
  'What KIND of domain this is: a website, a mail domain, a brand, a regional or historical domain. `primary_website` is the default because a directory seed knows a website, not a mail domain.';
comment on column public.company_domains.evidence_confidence is
  'How strong the evidence for this claim is: high, medium, low, unknown. NEVER upgraded by proving the domain — `verified` records the proof, and these are two different facts.';
comment on column public.company_domains.source is
  'Which layer asserted this claim (curated, wikidata-p856, an operator). Read by the report and the re-check job.';


-- ─── domain_evidence: the OBSERVATIONS ──────────────────────

-- Why this is a table and not `company_domains.evidence_count` + `source_url`:
-- a claim's confidence is a function of MANY observations, each with its own
-- URL, kind and time. A count cannot be re-checked and drifts the moment one of
-- its rows is retired. This is the table the re-check job writes to, the one a
-- correction points at, and the reason a claim row does not store what it was
-- derived from.
create table if not exists public.domain_evidence (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  domain        text not null,
  evidence_type text not null,
  source_url    text,
  source        text,
  -- Has a human (or a first-party document read by one) actually seen this?
  -- Unchecked evidence can never lift a claim above `low`.
  checked       boolean not null default false,
  observed_at   timestamptz,
  created_at    timestamptz not null default now(),
  -- The kinds that must never be accepted, whatever a layer claims: a redirect
  -- to a company's site says the domain points at the company, which is a
  -- marketing decision or a parked-domain default, not a mailbox. MX proves
  -- mail infrastructure exists and is supporting-only (see the confidence rank).
  constraint domain_evidence_type_check check (evidence_type not in (
    'redirect_from_website', 'website_domain_match', 'mx_only'
  ))
);

create index if not exists domain_evidence_domain_idx on public.domain_evidence (domain);
create index if not exists domain_evidence_company_idx on public.domain_evidence (company_id);

-- One row per observation. This is a unique INDEX rather than a table
-- constraint because NULLs are distinct in a unique index, so the obvious
-- `unique (company_id, domain, evidence_type, source_url)` would let every
-- URL-less observation insert again on every re-run — exactly the rows OTP
-- proofs and imports produce, which are the ones that must dedupe. Folding
-- NULL to the empty string is what makes "one observation" true.
create unique index if not exists domain_evidence_domain_key
  on public.domain_evidence (company_id, domain, evidence_type, (coalesce(source_url, '')));

comment on index public.domain_evidence_domain_key is
  'One row per (company, domain, evidence kind, source URL), counting a missing URL as the empty string so re-running an import or re-proving a mailbox updates the observation instead of appending a duplicate.';

comment on table public.domain_evidence is
  'One observed piece of evidence that a company uses a domain. Rows are the provenance of a claim: they are added and retired, never edited into agreement, and `checked` decides how far they can lift a confidence.';


-- ─── company_aliases: the names search has to answer ────────

create table if not exists public.company_aliases (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  alias      text not null check (char_length(btrim(alias)) between 1 and 120),
  alias_type text not null default 'alias' check (alias_type in (
    'alias', 'former_name', 'brand', 'abbreviation', 'transliteration'
  )),
  source     text,
  created_at timestamptz not null default now(),
  constraint company_aliases_company_alias_key unique (company_id, alias)
);

create index if not exists company_aliases_company_idx
  on public.company_aliases (company_id);
-- (The trigram index on `alias`, which the search rewrite reads, is created in
-- the search section below with the rest of them, because the operator class
-- has to be resolved through the schema pg_trgm actually lives in.)

comment on table public.company_aliases is
  'Search names for a company: aliases, former names, abbreviations. `alias_type` matters because a FORMER NAME must never merge two entities — "Facebook Inc." is how Meta Platforms used to be spelled, and it is not the Facebook brand entity.';


-- ─── company_relationships: structure, never ownership ──────

create table if not exists public.company_relationships (
  id                uuid primary key default gen_random_uuid(),
  parent_company_id uuid not null references public.companies (id) on delete cascade,
  child_company_id  uuid not null references public.companies (id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'parent', 'subsidiary', 'brand', 'division', 'acquired_company', 'former_name'
  )),
  source            text,
  source_url        text,
  created_at        timestamptz not null default now(),
  constraint company_relationships_unique unique (parent_company_id, child_company_id, relationship_type),
  constraint company_relationships_not_self check (parent_company_id <> child_company_id)
);

create index if not exists company_relationships_parent_idx
  on public.company_relationships (parent_company_id);
create index if not exists company_relationships_child_idx
  on public.company_relationships (child_company_id);

comment on table public.company_relationships is
  'Who owns whom, as structure only. No function in this migration reads it to answer a domain question: Meta owning WhatsApp must not make meta.com a WhatsApp domain or the reverse. A column on `companies` could not express a company that is both a parent and a subsidiary, nor a relationship that ends.';


-- ─── company_domain_delegations: acceptable mailboxes ───────

create table if not exists public.company_domain_delegations (
  id            uuid primary key default gen_random_uuid(),
  -- Who may verify: the entity whose staff hold the mailboxes.
  company_id    uuid not null references public.companies (id) on delete cascade,
  -- On whose domain.
  domain        text not null check (domain = lower(btrim(domain))),
  -- The steward that grants it. Must itself be a claimant of the domain.
  granted_by    uuid not null references public.companies (id) on delete cascade,
  evidence      jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  review_status text not null default 'unreviewed' check (review_status in (
    'unreviewed', 'reviewed', 'rejected'
  )),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint company_domain_delegations_unique unique (company_id, domain),
  constraint company_domain_delegations_not_self check (company_id <> granted_by)
);

comment on table public.company_domain_delegations is
  'The ONLY mechanism that lets one entity''s staff verify on another entity''s domain, and it is never inferred from a parent/subsidiary relationship. Grants nothing until review_status = reviewed and the evidence carries at least one CHECKED, non-supporting observation (see company_domain_delegation_allowed).';


-- ─── Access ─────────────────────────────────────────────────

alter table public.domain_evidence              enable row level security;
alter table public.company_aliases              enable row level security;
alter table public.company_relationships        enable row level security;
alter table public.company_domain_delegations   enable row level security;

revoke all on table public.domain_evidence            from anon, authenticated;
revoke all on table public.company_aliases            from anon, authenticated;
revoke all on table public.company_relationships      from anon, authenticated;
revoke all on table public.company_domain_delegations from anon, authenticated;


-- ─── The challenge learns what the domain looked like ───────

-- `domain_owner_company_id` is the steward recorded at the moment the code was
-- sent (null when nobody stewards the domain), `via_delegation` says the member
-- is proving through someone else's domain, and `contested` records that the
-- domain had competing claims with no proof. Confirm re-validates all of it
-- rather than trusting these — they are the audit trail, not the permission.
alter table public.company_email_verifications
  add column if not exists domain_owner_company_id uuid references public.companies (id) on delete set null,
  add column if not exists via_delegation          boolean not null default false,
  add column if not exists contested               boolean not null default false;


-- ─── Helpers ────────────────────────────────────────────────

-- The one place that ranks evidence strength, so "medium or better" means the
-- same thing everywhere. Unknown is 0 on purpose: a directory row nobody has
-- checked is weaker than an unverified claim somebody curated.
create or replace function public.company_confidence_rank(p_confidence text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_confidence, 'unknown'))
    when 'high' then 3
    when 'medium' then 2
    when 'low' then 1
    else 0
  end;
$$;

comment on function public.company_confidence_rank(text) is
  'High/medium/low/unknown as a number, so every rule that says "medium or better" ranks the same way.';

revoke all on function public.company_confidence_rank(text) from public, anon, authenticated;
grant execute on function public.company_confidence_rank(text) to service_role;


-- The eligibility threshold, in one place: `high` or `medium` is enough for an
-- OTP to promote a claim, `low` and `unknown` are not. Read by both verification
-- functions, so there is no second opinion about where the line is.
create or replace function public.company_confidence_meets_threshold(p_confidence text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.company_confidence_rank(p_confidence) >= 2;
$$;

comment on function public.company_confidence_meets_threshold(text) is
  'True for high/medium evidence. Below this, an OTP proves domain control only — it never turns a directory guess into verified company ownership.';

revoke all on function public.company_confidence_meets_threshold(text) from public, anon, authenticated;
grant execute on function public.company_confidence_meets_threshold(text) to service_role;


-- Who owns a domain, and how sure are we. A proof decides; otherwise the
-- strongest claim; a tie at the top tier with no proof is CONTESTED and says
-- so instead of silently picking a winner. The row is still returned for a
-- contested domain (with `contested` true) because the operator report and the
-- refusal copy both need to name somebody — but nothing may treat `contested`
-- as ownership.
create or replace function public.company_domain_steward(p_domain text)
returns table (
  company_id          uuid,
  name                text,
  slug                text,
  verified            boolean,
  evidence_confidence text,
  domain_type         text,
  claim_count         integer,
  contested           boolean,
  retired             boolean,
  resolution          text
)
language sql
stable
security definer
set search_path = ''
as $$
  with claims as (
    select
      d.id, d.company_id, d.verified, d.evidence_confidence, d.domain_type, d.created_at,
      -- Observations that only establish DOMAIN CONTROL are recorded (see the
      -- verification functions) but deliberately do not weigh a claim: they say
      -- somebody has a mailbox there, never that the claim is right, and the
      -- resolver must not hand a guess more authority because of one.
      (select count(*) from public.domain_evidence as e
        where e.domain = d.domain and e.company_id = d.company_id
          and e.source is distinct from 'member_domain_control') as evidence_count,
      -- Retired by an operator (a reassignment says this company does not have
      -- the domain any more). The row is kept — it is history — but it stops
      -- competing for the steward, otherwise the company that just gave the
      -- domain up would tie with the one that received it.
      exists (
        select 1 from public.domain_evidence as e
        where e.domain = d.domain and e.company_id = d.company_id
          and e.evidence_type = 'operator_reassignment_retired'
      ) as retired
    from public.company_domains as d
    where d.domain = lower(btrim(coalesce(p_domain, '')))
      and exists (
        select 1 from public.companies as c where c.id = d.company_id and c.is_active
      )
  ), ranked as (
    select
      cl.*,
      count(*) over () as claim_count,
      row_number() over (
        order by cl.verified desc,
                 cl.retired asc,
                 public.company_confidence_rank(cl.evidence_confidence) desc,
                 cl.evidence_count desc,
                 cl.created_at asc,
                 cl.company_id asc
      ) as rn
    from claims as cl
  ), best as (
    select * from ranked where rn = 1
  )
  select
    c.id,
    c.name,
    c.slug,
    b.verified,
    b.evidence_confidence,
    b.domain_type,
    b.claim_count::integer,
    -- Contested = more than one claim ties at the best tier. A verified claim
    -- plus any number of hints is NOT contested: the proof already decided. A
    -- retired claim never ties for the steward; it only surfaces when it is the
    -- only thing left, and then `retired` says so.
    coalesce((
      select count(*) from ranked as r2
      where r2.rn > 1
        and r2.verified = b.verified
        and r2.retired = b.retired
        and public.company_confidence_rank(r2.evidence_confidence)
            = public.company_confidence_rank(b.evidence_confidence)
    ), 0) > 0,
    b.retired,
    case
      when b.verified then 'verified'
      when b.claim_count > 1 and exists (
        select 1 from ranked as r3
        where r3.rn > 1
          and r3.retired = b.retired
          and public.company_confidence_rank(r3.evidence_confidence)
              = public.company_confidence_rank(b.evidence_confidence)
      ) then 'contested'
      else 'claim'
    end
  from best as b
  join public.companies as c on c.id = b.company_id
  limit 1;
$$;

comment on function public.company_domain_steward(text) is
  'The resolved owner of a domain: a proof if there is one, otherwise the strongest claim, with `contested` telling the caller that the answer is a tie rather than a decision. Answers "who is this domain?" for routing and for refusal copy; it never grants a claim.';

revoke all on function public.company_domain_steward(text) from public, anon, authenticated;
grant execute on function public.company_domain_steward(text) to service_role;


-- Every claim on a domain, for an operator (and for the tests) asking "why does
-- this domain look the way it does?". `superseded` is derived, not stored: an
-- unverified claim on a domain somebody has proved is superseded, and it stays
-- in the table rather than being deleted for disagreeing.
create or replace function public.company_domain_claims(p_domain text)
returns table (
  company_id          uuid,
  name                text,
  slug                text,
  is_active           boolean,
  verified            boolean,
  domain_type         text,
  evidence_confidence text,
  source              text,
  evidence_count      bigint,
  claim_created_at    timestamptz,
  superseded          boolean,
  retired             boolean
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
    c.is_active,
    d.verified,
    d.domain_type,
    d.evidence_confidence,
    d.source,
    (select count(*) from public.domain_evidence as e
      where e.domain = d.domain and e.company_id = d.company_id
        and e.source is distinct from 'member_domain_control'),
    d.created_at,
    (not d.verified and exists (
      select 1 from public.company_domains as v
      where v.domain = d.domain and v.verified and v.company_id <> d.company_id
    )),
    exists (
      select 1 from public.domain_evidence as e
      where e.domain = d.domain and e.company_id = d.company_id
        and e.evidence_type = 'operator_reassignment_retired'
    )
  from public.company_domains as d
  join public.companies as c on c.id = d.company_id
  where d.domain = lower(btrim(coalesce(p_domain, '')))
  order by d.verified desc,
           public.company_confidence_rank(d.evidence_confidence) desc,
           d.created_at asc,
           c.name asc;
$$;

comment on function public.company_domain_claims(text) is
  'Every claim on a domain with its evidence, including the ones a proof superseded. The audit view of a contested or surprising domain: nothing here is deleted for disagreeing with a proof.';

revoke all on function public.company_domain_claims(text) from public, anon, authenticated;
grant execute on function public.company_domain_claims(text) to service_role;


-- Whether a review has actually established that this company's staff may prove
-- a mailbox on a domain another company stewards. Three things have to hold,
-- and none of them is a relationship:
--   * the delegation was reviewed (not merely recorded);
--   * the GRANTOR is itself a claimant of the domain — a delegation from a
--     company with no claim on it is a claim in disguise, which is the one
--     thing the claim table exists to prevent;
--   * at least one evidence entry was actually checked and is not
--     supporting-only: MX and CT records prove mail infrastructure exists,
--     never that a person's mailbox is on the domain.
create or replace function public.company_domain_delegation_allowed(
  p_company_id uuid,
  p_domain     text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_domain_delegations as dl
    where dl.company_id = p_company_id
      and dl.domain = lower(btrim(coalesce(p_domain, '')))
      and dl.review_status = 'reviewed'
      and exists (
        select 1 from public.company_domains as d
        where d.domain = dl.domain and d.company_id = dl.granted_by
      )
      and exists (
        select 1
        from jsonb_array_elements(dl.evidence) as entry(value)
        where case
                when jsonb_typeof(entry.value -> 'checked') = 'boolean'
                  then (entry.value ->> 'checked')::boolean
                else false
              end
          and coalesce(entry.value ->> 'type', '') not in (
            'mx_record', 'ct_certificate', 'mx', 'mx_only',
            'redirect_from_website', 'website_domain_match'
          )
      )
  );
$$;

comment on function public.company_domain_delegation_allowed(uuid, text) is
  'True only when a REVIEWED delegation with checked, non-supporting evidence lets this company verify on this domain. Relationships, MX records and redirects are not consulted.';

revoke all on function public.company_domain_delegation_allowed(uuid, text) from public, anon, authenticated;
grant execute on function public.company_domain_delegation_allowed(uuid, text) to service_role;


-- ─── Start a challenge ──────────────────────────────────────

-- What changed, and why:
--
--   C  a domain verified by another company is refused BEFORE a challenge is
--      opened (the old code opened one and only failed at confirm). The detail
--      names the owner so the member can join it.
--   D  a domain with competing unverified claims is not a refusal. The member
--      proves the mailbox; if a claim of their own company exists at any
--      confidence, that is enough, and `contested` is recorded on the challenge.
--   F  a company that has no claim of its own on the domain can only proceed
--      through a reviewed delegation; otherwise it is refused with the steward
--      named, so the member can join that company instead.
--   H  creating a company no longer lets a WEAK claim reserve a domain. A claim
--      blocks only when it is medium-or-better evidence, or when the name is
--      already taken. Low/unknown claims (the whole 4,574-row directory seed)
--      are evidence the new company supersedes by proving the mailbox.
-- Dropped rather than replaced: the result gains `claim_confidence`, which is
-- what tells the caller whether a code entered against this company can
-- establish the company association or only control of the mailbox.
drop function if exists public.start_company_verification(uuid, text, text, text, uuid, text, integer);

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
  verification_id  uuid,
  company_id       uuid,
  company_name     text,
  domain           text,
  work_email       text,
  expires_at       timestamptz,
  claim_confidence text
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
  v_own_claim       boolean := false;
  v_owner_id        uuid;
  v_owner_name      text;
  v_owner_verified  boolean := false;
  v_steward_id      uuid;
  v_steward_name    text;
  v_steward_verified boolean := false;
  v_contested       boolean := false;
  v_claim_count     integer := 0;
  v_claim_confidence text;
  v_strong_id       uuid;
  v_strong_name     text;
  v_via_delegation  boolean := false;
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

  -- The resolved state of the domain, read once.
  select s.company_id, s.name, s.verified, s.claim_count, s.contested
    into v_steward_id, v_steward_name, v_steward_verified, v_claim_count, v_contested
  from public.company_domain_steward(v_domain) as s;

  if v_company_id is not null then
    -- ── Joining an existing company ──────────────────────────
    select c.name into v_company_name
    from public.companies as c
    where c.id = v_company_id and c.is_active;

    if v_company_name is null then
      raise exception using errcode = 'P0001', message = 'company_inactive';
    end if;

    select exists (
      select 1 from public.company_domains as d
      where d.company_id = v_company_id and d.domain = v_domain
    ) into v_own_claim;

    if v_own_claim then
      -- A, B, D and E: the member picked this company and it claims the domain.
      -- The challenge always opens — the member may legitimately be checking
      -- their own mailbox — but it carries the confidence, because a code
      -- against a `low`/`unknown` claim can only establish domain control.
      select d.evidence_confidence into v_claim_confidence
      from public.company_domains as d
      where d.company_id = v_company_id and d.domain = v_domain
      order by public.company_confidence_rank(d.evidence_confidence) desc
      limit 1;

      v_owner_id := v_company_id;
    elsif public.company_domain_delegation_allowed(v_company_id, v_domain) then
      -- F: the domain belongs to another entity and a reviewed delegation says
      -- this one's staff do use it. This is checked BEFORE the proof-owner
      -- refusal below, because a delegation exists precisely for the case
      -- where the steward's domain is already proved — refusing first would
      -- make a delegation useless for the thing it is for. The steward stays
      -- who it was: nobody's claim moved.
      v_via_delegation := true;
      v_owner_id := v_steward_id;
    elsif v_steward_verified and v_steward_id is distinct from v_company_id then
      -- C: somebody else proved it, and no delegation covers this member.
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_steward_id,
          'company_name', v_steward_name,
          'reason', 'verified'
        )::text;
    else
      -- No claim of its own and no delegation: the domain is not one this
      -- company has any basis to accept, whether or not somebody else claims it.
      raise exception using errcode = 'P0001', message = 'domain_not_verified_for_company',
        detail = jsonb_build_object(
          'reason', 'not_a_company_domain',
          'company_id', v_steward_id,
          'company_name', v_steward_name
        )::text;
    end if;

    if exists (
      select 1 from public.company_members as m
      where m.company_id = v_company_id and m.user_id = p_user_id and m.verified
    ) then
      raise exception using errcode = 'P0001', message = 'already_member';
    end if;
  else
    -- ── Creating a company ───────────────────────────────────
    v_company_name := nullif(btrim(coalesce(p_company_name, '')), '');
    if v_company_name is null then
      raise exception using errcode = '22023', message = 'company_name_required';
    end if;

    if v_steward_verified then
      -- The domain is proved. A new company would be a duplicate from the
      -- typed name; join the one that proved it.
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_steward_id,
          'company_name', v_steward_name,
          'reason', 'verified'
        )::text;
    end if;

    -- H. A claim blocks a new company only when it is medium-or-better
    -- evidence: that is a reviewed source saying "this is a real mail domain
    -- for this company", and minting a second company for it would split the
    -- domain. A low/unknown claim does NOT block — it is exactly the case the
    -- directory seed creates thousands of, and a bad seed must never be able to
    -- reserve a domain that a real company can prove.
    select d.company_id, c.name into v_strong_id, v_strong_name
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id and c.is_active
    where d.domain = v_domain
      and not d.verified
      and d.evidence_confidence in ('high', 'medium')
    order by public.company_confidence_rank(d.evidence_confidence) desc, d.created_at asc
    limit 1;

    if v_strong_id is not null then
      raise exception using errcode = 'P0001', message = 'domain_already_verified',
        detail = jsonb_build_object(
          'company_id', v_strong_id,
          'company_name', v_strong_name,
          'reason', 'reserved'
        )::text;
    end if;

    -- Anti-impersonation: an existing company name cannot be re-created under
    -- a domain that company does not own. Without this, "Google" + a work
    -- email on some unrelated domain would put the word Google on a profile as
    -- a brand-new company. This also covers a weak claim whose company carries
    -- the very name being typed: joining it is the only way forward.
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
    user_id, company_id, company_name, domain, work_email, code_hash, expires_at,
    domain_owner_company_id, via_delegation, contested
  ) values (
    p_user_id, v_company_id, v_company_name, v_domain, v_email, p_code_hash, v_expires_at,
    v_owner_id, v_via_delegation, coalesce(v_contested, false)
  )
  returning id into v_verification_id;

  return query
  select v_verification_id, v_company_id, v_company_name, v_domain, v_email, v_expires_at,
         v_claim_confidence;
end;
$$;

comment on function public.start_company_verification(uuid, text, text, text, uuid, text, integer) is
  'Opens a work-email challenge. Refuses a domain another company has verified (offering the owner), accepts any claim of the selected company, accepts another company''s domain only through a reviewed delegation, lets a weak directory hint be superseded instead of reserving a domain, and reports the claim''s confidence so the caller knows whether the code can establish the company or only domain control.';


-- ─── Confirm a challenge (the atomic commit) ────────────────

-- Everything that makes a membership real still happens in this transaction.
-- Added here:
--   * the create path re-checks for a MEDIUM+ claim (a weak hint that appeared
--     mid-flight does not block, because the member's proof supersedes it);
--   * the join path accepts a domain the company has no claim on when a
--     reviewed delegation allows it, promoting NO claim of its own — the
--     steward keeps the domain;
--   * a successful proof is recorded as evidence (`work_email_otp`) and the
--     result says how the member got in: `own_domain` or `delegation`.
-- Dropped rather than replaced: the result gains `domain_owner_company_id`
-- and `verified_via`, and PostgreSQL refuses to change an existing function's
-- return type. The grants are re-issued at the end of this file.
drop function if exists public.confirm_company_verification(uuid, uuid, text);

create or replace function public.confirm_company_verification(
  p_user_id         uuid,
  p_verification_id uuid,
  p_code_hash       text
)
returns table (
  status                 text,
  attempts_left          integer,
  company_id             uuid,
  company_name           text,
  company_slug           text,
  company_logo_url       text,
  domain                 text,
  joined_at              timestamptz,
  domain_owner_company_id uuid,
  verified_via           text,
  claim_confidence       text
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
  v_strong_id     uuid;
  v_via           text;
  v_claim_confidence text;
  v_attempts      integer;
begin
  select * into v_row
  from public.company_email_verifications as v
  where v.id = p_verification_id and v.user_id = p_user_id
  for update;

  if v_row.id is null then
    return query select 'not_found'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  if v_row.consumed_at is not null then
    return query select 'already_used'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, null::integer, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  v_attempts := v_row.attempts;

  if v_attempts >= 5 then
    return query select 'too_many_attempts'::text, 0, null::uuid, null::text,
      null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  if v_row.code_hash is distinct from p_code_hash then
    update public.company_email_verifications as v
    set attempts = v.attempts + 1
    where v.id = v_row.id
    returning v.attempts into v_attempts;

    -- The last wrong guess burns the challenge: the route sends the member back
    -- to the start, which also invalidates the emailed code.
    if v_attempts >= 5 then
      update public.company_email_verifications as v
      set consumed_at = now()
      where v.id = v_row.id;
    end if;

    return query select 'invalid_code'::text, greatest(5 - v_attempts, 0), null::uuid,
      null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
    return;
  end if;

  -- Is the domain already someone's verified domain?
  select d.company_id into v_owner_id
  from public.company_domains as d
  where d.domain = v_row.domain and d.verified
  limit 1;

  if v_row.company_id is not null then
    -- ── Joining an existing company ──────────────────────────
    select c.id, c.name, c.slug, c.logo_url
      into v_company_id, v_company_name, v_company_slug, v_logo_url
    from public.companies as c
    where c.id = v_row.company_id and c.is_active;

    if v_company_id is null then
      return query select 'company_inactive'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    if v_owner_id is distinct from v_company_id then
      -- Nobody has proved this domain for this company. Two ways in remain.
      if v_owner_id is not null then
        -- Proved by somebody else between start and confirm: only a reviewed
        -- delegation saves the challenge, because the domain is theirs.
        if public.company_domain_delegation_allowed(v_company_id, v_row.domain) then
          v_via := 'delegation';
        else
          return query select 'domain_already_verified'::text, null::integer, null::uuid,
            null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
          return;
        end if;
      elsif exists (
        select 1 from public.company_domains as d
        where d.company_id = v_company_id and d.domain = v_row.domain and not d.verified
      ) then
        -- The company's own claim. Whether the code may PROMOTE it depends on
        -- the evidence behind it:
        --
        --   high/medium  a reviewed source says this is the company's mail
        --                domain; the member's mailbox settles it -> verified.
        --   low/unknown  a guess (every one of the 4,574 seeded hints). The
        --                code proves DOMAIN CONTROL, which is a true
        --                observation about the mailbox and says nothing about
        --                whether the directory mapped the domain to the right
        --                company. It is recorded as evidence and nothing else:
        --                no verified claim, no membership. Otherwise anyone
        --                holding a mailbox at a domain the directory guessed
        --                could hand that guess the authority of a proof.
        select d.evidence_confidence into v_claim_confidence
        from public.company_domains as d
        where d.company_id = v_company_id and d.domain = v_row.domain and not d.verified
        order by public.company_confidence_rank(d.evidence_confidence) desc
        limit 1;

        if not public.company_confidence_meets_threshold(v_claim_confidence) then
          insert into public.domain_evidence (
            company_id, domain, evidence_type, source_url, source, checked, observed_at
          ) values (
            v_company_id, v_row.domain, 'work_email_otp', null, 'member_domain_control', true, now()
          )
          on conflict do nothing;

          -- The challenge is spent either way: the code was correct, and
          -- leaving it live would let the same mailbox be replayed.
          update public.company_email_verifications as v
          set consumed_at = now()
          where v.id = v_row.id;

          return query select 'domain_control_only'::text, null::integer, null::uuid,
            null::text, null::text, null::text, null::text, null::timestamptz, null::uuid,
            null::text, v_claim_confidence;
          return;
        end if;

        -- Above the threshold: the proof is what promotes the claim, and the
        -- promotion is where the race is decided — the partial unique index is
        -- the boundary, so a concurrent proof by another company raises
        -- unique_violation, caught here (it must not roll back the challenge)
        -- and answered with `domain_already_verified` so the member joins that
        -- company instead.
        begin
          update public.company_domains as d
          set verified = true, verified_at = now()
          where d.company_id = v_company_id
            and d.domain = v_row.domain
            and not d.verified;
        exception when unique_violation then
          return query select 'domain_already_verified'::text, null::integer, null::uuid,
            null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
          return;
        end;

        if not found then
          select d.company_id into v_owner_id
          from public.company_domains as d
          where d.domain = v_row.domain and d.verified
          limit 1;

          if v_owner_id is distinct from v_company_id then
            return query select 'domain_already_verified'::text, null::integer, null::uuid,
              null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
            return;
          end if;
        else
          insert into public.domain_evidence (
            company_id, domain, evidence_type, source_url, source, checked, observed_at
          ) values (
            v_company_id, v_row.domain, 'work_email_otp', null, 'member_verification', true, now()
          )
          on conflict do nothing;
        end if;

        v_via := 'own_domain';
      elsif public.company_domain_delegation_allowed(v_company_id, v_row.domain) then
        -- No claim of its own, no proof anywhere, but a reviewed delegation
        -- says this company's staff do use the domain. The membership is this
        -- company's; the domain is not claimed on its behalf.
        select s.company_id into v_owner_id
        from public.company_domain_steward(v_row.domain) as s;

        v_via := 'delegation';
      else
        return query select 'domain_not_verified'::text, null::integer, null::uuid,
          null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
        return;
      end if;
    else
      v_via := 'own_domain';
    end if;
  else
    -- ── Creating a company from the name typed at start ──────
    if v_owner_id is not null then
      return query select 'domain_already_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
      return;
    end if;

    -- A MEDIUM+ claim that appeared between the challenge and this confirmation
    -- (a reviewed layer, or an operator preparing the entry) must not be spent
    -- on a second company for the same domain. A weak hint does not block: the
    -- proof below supersedes it, and the hint survives as evidence.
    select d.company_id into v_strong_id
    from public.company_domains as d
    join public.companies as c on c.id = d.company_id and c.is_active
    where d.domain = v_row.domain
      and not d.verified
      and d.evidence_confidence in ('high', 'medium')
    limit 1;

    if v_strong_id is not null then
      return query select 'domain_already_verified'::text, null::integer, null::uuid,
        null::text, null::text, null::text, null::text, null::timestamptz, null::uuid, null::text, null::text;
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

    insert into public.company_domains (
      company_id, domain, verified, verified_at, domain_type, evidence_confidence, source
    )
    values (v_company_id, v_row.domain, true, now(), 'corporate_email', 'high', 'member_verification')
    on conflict do nothing
    returning id into v_domain_row_id;

    if v_domain_row_id is null then
      -- Another member verified this domain in the meantime. Raising rolls
      -- back the company row inserted above, so no orphan duplicate is left.
      raise exception using errcode = 'P0001', message = 'domain_already_verified';
    end if;

    insert into public.domain_evidence (
      company_id, domain, evidence_type, source_url, source, checked, observed_at
    ) values (
      v_company_id, v_row.domain, 'work_email_otp', null, 'member_verification', true, now()
    )
    on conflict do nothing;

    v_via := 'own_domain';
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

  -- The steward the member's membership is NOT: null for their own company
  -- (the ordinary case), the owner of the domain when they verified through a
  -- delegation. Returned so the UI can say whose domain it was.
  return query select 'verified'::text, null::integer, v_company_id, v_company_name,
    v_company_slug, v_logo_url, v_row.domain, v_joined_at,
    case when v_via = 'delegation' then v_owner_id else null end,
    coalesce(v_via, 'own_domain'),
    v_claim_confidence;
end;
$$;

comment on function public.confirm_company_verification(uuid, uuid, text) is
  'Commits a proved work email: creates or resolves the company, claims or promotes the domain, records the membership and points the profile at it. A proof only promotes a claim whose evidence is high or medium — against a weak directory claim it answers domain_control_only and grants no membership, because a mailbox does not prove the directory mapped the domain correctly.';


-- ─── Reassign a domain (an operator action, never a data import) ────

-- Case I: a domain was proved, and then the company was acquired, split or the
-- domain resold. The verified claim stays where it is until somebody decides
-- otherwise; this is that decision, and it is deliberately manual.
--
-- What it does NOT do: it does not delete the old claim (it stays as evidence
-- that a member once proved it), it does not touch memberships, and it does not
-- verify anything for the new company — the new claim is unverified at medium
-- confidence, so the new company still has to prove a mailbox.
create or replace function public.reassign_company_domain(
  p_domain          text,
  p_from_company_id uuid,
  p_to_company_id   uuid,
  p_reason          text,
  p_actor_id        uuid default null
)
returns table (
  status          text,
  from_company_id uuid,
  to_company_id   uuid,
  domain          text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_domain = '' or v_domain <> p_domain then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  if p_from_company_id is null or p_to_company_id is null
     or p_from_company_id = p_to_company_id then
    raise exception using errcode = '22023', message = 'invalid_companies';
  end if;

  -- A reassignment is a decision somebody made, so it has to carry its reason.
  if v_reason is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;

  if not exists (
    select 1 from public.companies as c where c.id = p_to_company_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'company_inactive';
  end if;

  update public.company_domains as d
  set verified = false, verified_at = null
  where d.company_id = p_from_company_id and d.domain = v_domain and d.verified;

  if not found then
    return query select 'not_owner'::text, p_from_company_id, p_to_company_id, v_domain;
    return;
  end if;

  insert into public.company_domains (
    company_id, domain, verified, domain_type, evidence_confidence, source
  ) values (
    p_to_company_id, v_domain, false, 'corporate_email', 'medium', 'operator_reassignment'
  )
  on conflict on constraint company_domains_company_domain_key
    do update set evidence_confidence = 'medium',
                  source = 'operator_reassignment';

  insert into public.domain_evidence (
    company_id, domain, evidence_type, source_url, source, checked, observed_at
  ) values (
    p_to_company_id, v_domain, 'operator_reassignment', null, 'operator', true, now()
  )
  on conflict do nothing;

  -- And the other side of the same decision: the company that lost the domain
  -- keeps its claim (history is not deleted) but stops competing for the
  -- steward, because an operator has said the domain is not theirs. Without
  -- this the two claims would tie and the domain would read as contested, which
  -- is the opposite of what a reassignment means.
  insert into public.domain_evidence (
    company_id, domain, evidence_type, source_url, source, checked, observed_at
  ) values (
    p_from_company_id, v_domain, 'operator_reassignment_retired', null, 'operator', true, now()
  )
  on conflict do nothing;

  return query select 'reassigned'::text, p_from_company_id, p_to_company_id, v_domain;
end;
$$;

comment on function public.reassign_company_domain(text, uuid, uuid, text, uuid) is
  'Moves a PROVED domain to another company: unverifies the old claim (keeping it as history), retires it as evidence of the operator decision, adds a medium-confidence claim for the new company, and leaves every membership alone. The new company still has to prove a mailbox.';


-- ─── Search ─────────────────────────────────────────────────

-- The picker's search was one `OR` across name, slug and domain, which no
-- ordinary index can serve: at 500,000 rows it sequential-scans and sorts the
-- whole table. Split into arms, each served by its own index, the same query
-- drops from ~208 ms to ~12 ms (scripts/bench-company-directory.sh).
--
-- `idx_companies_name` is on lower(name) while the browse ordering is by name,
-- so an empty query could not use it either; browse gets `(is_active, name)`.
create index if not exists companies_active_name_idx
  on public.companies (is_active, name);

-- Trigram indexes for the substring arms. `gin_trgm_ops` is addressed through
-- the schema the extension actually lives in: a live project may already have
-- pg_trgm from Supabase's own defaults (usually `extensions`), while a scratch
-- database created before this migration has it in `public`, and the opclass
-- name in `create index` cannot be resolved through a function's
-- `search_path = ''`.
do $company_trgm_indexes$
declare
  v_schema   text;
  v_targets  text[][] := array[
    array['companies_name_trgm_idx', 'public.companies', 'name'],
    array['companies_slug_trgm_idx', 'public.companies', 'slug'],
    array['company_aliases_alias_trgm_idx', 'public.company_aliases', 'alias']
  ];
  v_target   text[];
begin
  select n.nspname into v_schema
  from pg_extension as e
  join pg_namespace as n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_schema is null then
    raise exception 'pg_trgm is not installed: the directory search needs it for its substring arms';
  end if;

  foreach v_target slice 1 in array v_targets loop
    execute format(
      'create index if not exists %I on %s using gin (%I %I.gin_trgm_ops)',
      v_target[1], v_target[2], v_target[3], v_schema
    );
  end loop;
end;
$company_trgm_indexes$;

-- A one- or two-character term is treated as a PREFIX, never a substring: a
-- two-letter trigram matches everything, so `%ab%` cannot be index-backed and
-- would read the entire directory on every keystroke. Prefix matching over
-- lower(name) can be.
create index if not exists companies_name_lower_prefix_idx
  on public.companies (lower(name) text_pattern_ops);

-- The last domain-related read that lacked an index. `company_domain_owner`
-- and `company_domain_steward` both look a domain up exactly; before this they
-- sequential-scanned `company_domains` (11 ms at 500k rows).
create index if not exists idx_company_domains_domain_lookup
  on public.company_domains (domain);

-- Dropped rather than replaced: the result gains `evidence_confidence` so a
-- caller can tell a proof from a hint, and PostgreSQL refuses to change a
-- function's return type in place.
drop function if exists public.search_companies(text, integer);

create or replace function public.search_companies(
  p_query text,
  p_limit integer default 10
)
returns table (
  id                  uuid,
  name                text,
  slug                text,
  logo_url            text,
  domain              text,
  verified            boolean,
  member_count        bigint,
  evidence_confidence text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Escaped for LIKE, and a lowercased copy for the domain/slug arms (the
  -- stored forms are already lowercase, and `ilike` cannot use a btree).
  v_term  text := public.company_search_term(p_query);
  v_lower text := lower(public.company_search_term(p_query));
  v_max   integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  -- An empty query browses the directory instead of returning nothing.
  if v_term = '' then
    return query
    select
      c.id, c.name, c.slug, c.logo_url,
      dom.domain,
      coalesce(dom.verified, false),
      (select count(*) from public.company_members as m
        where m.company_id = c.id and m.verified),
      dom.evidence_confidence
    from public.companies as c
    left join lateral (
      select d.domain, d.verified, d.evidence_confidence
      from public.company_domains as d
      where d.company_id = c.id
      order by d.verified desc,
               public.company_confidence_rank(d.evidence_confidence) desc,
               d.created_at asc,
               d.domain asc
      limit 1
    ) as dom on true
    where c.is_active
    order by c.name asc
    limit v_max;
    return;
  end if;

  if length(v_lower) < 3 then
    -- A prefix search: one or two characters are a start-of-name lookup, not a
    -- substring one, so each arm is anchored and every arm is index-backed.
    return query
    with matched as (
      -- Ordered by lower(name) because that is the index
      -- (companies_name_lower_prefix_idx): the range scan and the ordering are
      -- the same walk, so the arm stops as soon as it has 25.
      (select c.id as company_id, 0 as arm, true as name_prefix
       from public.companies as c
       where c.is_active and lower(c.name) like v_lower || '%'
       order by lower(c.name) asc
       limit v_max)
      union all
      (select c.id, 1, false
       from public.companies as c
       where c.is_active and c.slug like v_lower || '%'
       order by c.name asc
       limit v_max)
      union all
      (select d.company_id, 3, false
       from public.company_domains as d
       join public.companies as dc on dc.id = d.company_id and dc.is_active
       where d.domain like v_lower || '%'
       order by d.domain asc
       limit v_max)
    ), scored as (
      select company_id, min(arm) as arm, bool_or(name_prefix) as name_prefix
      from matched
      group by company_id
    )
    select
      c.id, c.name, c.slug, c.logo_url,
      dom.domain,
      coalesce(dom.verified, false),
      (select count(*) from public.company_members as m
        where m.company_id = c.id and m.verified),
      dom.evidence_confidence
    from scored as s
    join public.companies as c on c.id = s.company_id
    left join lateral (
      select d.domain, d.verified, d.evidence_confidence
      from public.company_domains as d
      where d.company_id = c.id
      order by d.verified desc,
               public.company_confidence_rank(d.evidence_confidence) desc,
               d.created_at asc,
               d.domain asc
      limit 1
    ) as dom on true
    order by s.name_prefix desc, coalesce(dom.verified, false) desc, c.name asc
    limit v_max;
    return;
  end if;

  -- Three characters or more: substring arms, each on its own index.
  --
  -- Every arm is BOUNDED by `v_max` and ordered by name inside itself. Two
  -- reasons, and both are about a big directory:
  --
  --   * an arm of a UNION ALL that has no limit of its own has to produce every
  --     match before the outer LIMIT can discard them, so a term matching 5% of
  --     500,000 rows makes the whole search cost that 5% — measured at 64 ms for
  --     a 5%-common name and 153 ms for a broad one at 100,000 rows;
  --   * the arms are ordered by WHERE THE MATCH IS (`strpos`), then by name,
  --     which keeps the 25 that survive deterministic without asking the planner
  --     for an ordering the trigram index cannot provide. Ordering by name
  --     instead makes the plan walk the name index and throw rows away until it
  --     finds 25 matches: measured at 500,000 rows that is 169–185 ms, against
  --     82 ms for the unordered bitmap, because the matches it needs are late in
  --     alphabetical order. `strpos` ranks a name starting with the term above
  --     one that contains it, which is also the better answer.
  --
  -- What this does not fix, deliberately: a term like 'ent' still matches a large
  -- share of the directory, and any search that must look inside every name pays
  -- for the matches it finds. The picker's interactive path is protected by the
  -- 2-character rule above (prefix only) and by the client's debounce; the honest
  -- numbers per tier are in docs/company-directory-architecture.md §11.
  return query
  with matched as (
    (select c.id as company_id, 0 as arm, (c.name ilike v_term || '%') as name_prefix
     from public.companies as c
     where c.is_active and c.name ilike '%' || v_term || '%'
     order by strpos(lower(c.name), v_lower), c.name asc
     limit v_max)
    union all
    (select c.id, 1, false
     from public.companies as c
     where c.is_active and c.slug ilike '%' || v_lower || '%'
     order by strpos(lower(c.slug), v_lower), c.slug asc
     limit v_max)
    union all
    (select a.company_id, 2, false
     from public.company_aliases as a
     join public.companies as ac on ac.id = a.company_id and ac.is_active
     where a.alias ilike '%' || v_term || '%'
     order by strpos(lower(a.alias), v_lower), a.alias asc
     limit v_max)
    union all
    -- Verified domains only: typing a domain asks "who owns this?", and a hint
    -- owns nothing. A hint is still reachable by the company's name.
    (select d.company_id, 3, false
     from public.company_domains as d
     join public.companies as dc on dc.id = d.company_id and dc.is_active
     where d.verified and d.domain like v_lower || '%'
     order by d.domain asc
     limit v_max)
  ), scored as (
    select company_id, min(arm) as arm, bool_or(name_prefix) as name_prefix
    from matched
    group by company_id
  )
  select
    c.id, c.name, c.slug, c.logo_url,
    dom.domain,
    coalesce(dom.verified, false),
    (select count(*) from public.company_members as m
      where m.company_id = c.id and m.verified),
    dom.evidence_confidence
  from scored as s
  join public.companies as c on c.id = s.company_id
  left join lateral (
    select d.domain, d.verified, d.evidence_confidence
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as dom on true
  order by s.name_prefix desc, coalesce(dom.verified, false) desc, c.name asc
  limit v_max;
end;
$$;

comment on function public.search_companies(text, integer) is
  'Directory search by name, slug, alias or verified domain, each arm index-backed. Reports the company''s primary domain (verified first, then the strongest claim) with `verified` and `evidence_confidence` so a caller can tell a proof from a hint.';


-- ─── Execute grants ─────────────────────────────────────────

revoke all on function public.start_company_verification(uuid, text, text, text, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.start_company_verification(uuid, text, text, text, uuid, text, integer)
  to service_role;

revoke all on function public.confirm_company_verification(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_company_verification(uuid, uuid, text) to service_role;

revoke all on function public.search_companies(text, integer) from public, anon, authenticated;
grant execute on function public.search_companies(text, integer) to service_role;

revoke all on function public.reassign_company_domain(text, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reassign_company_domain(text, uuid, uuid, text, uuid) to service_role;
