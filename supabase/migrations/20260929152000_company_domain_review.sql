-- ============================================================
-- Company domain review queue
--
-- The state the verification flow could not express yet:
--
--   a member proved a mailbox on a domain whose claim is weak
--     (confirm_company_verification -> 'domain_control_only')
--   -> somebody has to look at the mapping
--   -> the claim is promoted (and a later proof then verifies it)
--      or rejected (and the evidence stays where it is)
--
-- WHY A REVIEW IS NOT A VERIFICATION
--   A review decides how strong the EVIDENCE behind a company-domain claim is.
--   It does not decide that the company owns the domain: `verified` stays what
--   only a proved mailbox sets, which is the invariant the whole feature rests
--   on (see the comment on confirm_company_verification). A reviewer who could
--   write `verified = true` would be able to hand any company any domain
--   without a single person proving they work there — and the *first* real
--   employee who tried to verify would then be refused by their own domain.
--   So `promote` lifts a claim to the confidence a proof may act on
--   (high/medium), and the member's mailbox settles the rest. That is the
--   promotion policy in docs/company-directory-architecture.md §6a.
--
-- WHAT THE RECORD IS FOR
--   Every decision is attributable: reviewer_id, decision, reason, when, and
--   what the claim's confidence was before and after. Nothing here deletes an
--   observation — a rejection leaves the evidence exactly as it found it, so a
--   later reviewer (or a resolver that finds more) can reach a different answer
--   and the history explains both.
--
-- Ordering: after 20260929151000. Both the table's grants and the functions'
-- grants keep it service-role-only; there is no anonymous path to a promotion.
-- ============================================================

-- ─── The record ─────────────────────────────────────────────

create table if not exists public.company_domain_reviews (
  id                uuid primary key default gen_random_uuid(),
  domain            text not null,
  company_id        uuid not null references public.companies (id) on delete cascade,
  -- The observation the reviewer was looking at. `set null` rather than cascade:
  -- losing the pointer to the evidence must not lose the decision.
  evidence_id       uuid references public.domain_evidence (id) on delete set null,
  reviewer_id       uuid not null references public.users (id),
  decision          text not null,
  reason            text not null,
  -- What the decision changed, so the audit does not have to be reconstructed.
  before_confidence text,
  after_confidence  text,
  created_at        timestamptz not null default now(),
  constraint company_domain_reviews_domain_check
    check (domain = lower(btrim(domain)) and length(domain) >= 4),
  constraint company_domain_reviews_decision_check
    check (decision in ('promote', 'reject', 'needs_more_evidence')),
  -- A decision without a reason is not reviewable six months later.
  constraint company_domain_reviews_reason_check
    check (char_length(btrim(reason)) between 3 and 1000),
  constraint company_domain_reviews_confidence_check
    check (before_confidence is null or before_confidence in ('high', 'medium', 'low', 'unknown')),
  constraint company_domain_reviews_after_confidence_check
    check (after_confidence is null or after_confidence in ('high', 'medium', 'low', 'unknown'))
);

-- The queue reads the latest decision per (domain, company); the audit reads a
-- company's or a domain's history.
create index if not exists company_domain_reviews_domain_idx
  on public.company_domain_reviews (domain, created_at desc);
create index if not exists company_domain_reviews_company_idx
  on public.company_domain_reviews (company_id, created_at desc);
create index if not exists company_domain_reviews_reviewer_idx
  on public.company_domain_reviews (reviewer_id, created_at desc);

comment on table public.company_domain_reviews is
  'Append-only operator decisions about whether a company-domain claim''s evidence is strong enough for a mailbox proof to act on. Never deletes evidence, never writes `verified`, and always attributable to a reviewer.';

alter table public.company_domain_reviews enable row level security;
revoke all on table public.company_domain_reviews from anon, authenticated;


-- ─── Which evidence may lift a claim ────────────────────────

-- The kinds that can lift a claim to a confidence a proof may act on, and the
-- one that never can. Kept as a function so the review path and the future
-- resolver cannot drift apart on what counts.
--
--   * `member_domain_control` is REFUSED. It is a true statement about a
--     mailbox and says nothing about the mapping — it is exactly the evidence
--     the review exists to look past. A promotion backed only by it would be
--     the OTP bypassing itself.
--   * unchecked evidence is REFUSED: nobody has looked at it, which is the
--     definition of the weak claims this queue is for.
create or replace function public.company_domain_evidence_supports_promotion(
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
    from public.domain_evidence as e
    where e.company_id = p_company_id
      and e.domain = lower(btrim(coalesce(p_domain, '')))
      and e.checked
      and e.source is distinct from 'member_domain_control'
      -- The evidence kinds a reviewer may act on: something first-party says
      -- this company uses that domain. MX is absent on purpose (it proves mail
      -- infrastructure exists, not who uses it), and the denied kinds cannot be
      -- stored at all (see domain_evidence_type_check).
      and e.evidence_type in (
        'first_party_contact_page',
        'first_party_legal_page',
        'first_party_careers_page',
        'first_party_documentation',
        'published_corporate_email',
        'registry_record',
        'operator_review'
      )
  );
$$;

comment on function public.company_domain_evidence_supports_promotion(uuid, text) is
  'Whether a checked, non-OTP observation of a kind that can speak to corporate mail exists for (company, domain). The gate on every promotion: without it the answer is needs_more_evidence, because OTP evidence is deliberately excluded.';

revoke all on function public.company_domain_evidence_supports_promotion(uuid, text) from public, anon, authenticated;
grant execute on function public.company_domain_evidence_supports_promotion(uuid, text) to service_role;


-- ─── The queue ──────────────────────────────────────────────

-- What an operator should look at next: companies whose claim on a domain is
-- weak, where somebody has proved a mailbox on that domain anyway, and where no
-- reviewer has answered since. A domain whose last decision was `reject` comes
-- back only when NEW evidence has arrived after that rejection, so a rejection
-- is an answer rather than a loop.
create or replace function public.company_domain_review_queue(
  p_limit integer default 50
)
returns table (
  domain              text,
  company_id          uuid,
  company_name        text,
  company_slug        text,
  evidence_confidence text,
  observations        integer,
  first_observed_at   timestamptz,
  last_observed_at    timestamptz,
  last_decision       text,
  last_decision_at    timestamptz,
  review_count        integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with v_max as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as n
  ),
  observed as (
    select
      e.company_id,
      e.domain,
      count(*)::integer as observations,
      min(coalesce(e.observed_at, e.created_at)) as first_observed_at,
      max(coalesce(e.observed_at, e.created_at)) as last_observed_at
    from public.domain_evidence as e
    where e.source = 'member_domain_control'
    group by e.company_id, e.domain
  ),
  last_review as (
    select r.company_id, r.domain, r.decision, r.created_at, r.reason
    from (
      select
        r.*,
        row_number() over (
          partition by r.company_id, r.domain order by r.created_at desc, r.id desc
        ) as rn
      from public.company_domain_reviews as r
    ) as r
    where r.rn = 1
  )
  select
    o.domain,
    o.company_id,
    c.name,
    c.slug,
    d.evidence_confidence,
    o.observations,
    o.first_observed_at,
    o.last_observed_at,
    lr.decision,
    lr.created_at,
    (select count(*)::integer from public.company_domain_reviews as r
      where r.company_id = o.company_id and r.domain = o.domain)
  from observed as o
  join public.companies as c on c.id = o.company_id and c.is_active
  join public.company_domains as d on d.company_id = o.company_id and d.domain = o.domain
  left join last_review as lr on lr.company_id = o.company_id and lr.domain = o.domain
  where not d.verified
    -- Nor one somebody else has already proved for a different company: that is
    -- the reassignment path (`reassign_company_domain`), not a promotion, and
    -- offering it here would only produce a claim that can never be verified.
    and not exists (
      select 1 from public.company_domains as v
      where v.domain = o.domain and v.verified and v.company_id <> o.company_id
    )
    and (
      lr.decision is null
      or lr.decision = 'needs_more_evidence'
      -- Rejected, but something new has been observed since: the decision was an
      -- answer to the evidence that existed then, not a permanent verdict.
      or (
        lr.decision = 'reject'
        and exists (
          select 1 from public.domain_evidence as e2
          where e2.company_id = o.company_id
            and e2.domain = o.domain
            and coalesce(e2.observed_at, e2.created_at) > lr.created_at
        )
      )
    )
  order by o.last_observed_at desc, c.name asc, o.domain asc
  limit (select n from v_max);
$$;

comment on function public.company_domain_review_queue(integer) is
  'Domains where a member proved a mailbox but the claim''s evidence is too weak to verify it (`domain_control_only`), with whatever a reviewer needs to decide: the claim''s confidence, the observations, and the last decision. Excludes verified claims and re-surfaces a rejected one only when new evidence has arrived.';

revoke all on function public.company_domain_review_queue(integer) from public, anon, authenticated;
grant execute on function public.company_domain_review_queue(integer) to service_role;


-- ─── The decision ───────────────────────────────────────────

-- One decision, one row, one effect:
--
--   promote              the claim's evidence_confidence becomes `high` (or
--                        `medium` when the reviewer says so). The claim is now
--                        what a proved mailbox may settle — nothing is verified
--                        here, and no membership is created.
--   reject               the claim and its evidence are left exactly as they
--                        are; only the decision is recorded.
--   needs_more_evidence  recorded, and the item stays in the queue.
--
-- Refusals (returned as a status, not raised, so the operator sees why):
--   `no_claim`                 nothing to promote: the company holds no claim
--                              on that domain
--   `domain_verified_elsewhere` somebody has already proved the domain for
--                              another company: this is the reassignment path,
--                              not a promotion
--   `needs_evidence`           no checked first-party/registry evidence exists,
--                              and OTP evidence does not count
--   `already_verified`         a member has already proved the domain for this
--                              company: the claim is finished, and a reviewer
--                              editing it would be editing a proof's outcome
--   `already_promoted`         the claim is already at high, so promoting it
--                              again would say nothing new
create or replace function public.review_company_domain(
  p_domain      text,
  p_company_id  uuid,
  p_reviewer_id uuid,
  p_decision    text,
  p_reason      text,
  p_confidence  text default 'high',
  p_evidence_id uuid default null
)
returns table (
  status            text,
  domain            text,
  company_id        uuid,
  evidence_confidence text,
  verified          boolean,
  review_id         uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain    text := lower(btrim(coalesce(p_domain, '')));
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_decision  text := lower(btrim(coalesce(p_decision, '')));
  v_confidence text := lower(btrim(coalesce(p_confidence, 'high')));
  v_before    text;
  v_after     text;
  v_verified  boolean := false;
  v_owner_id  uuid;
  v_review_id uuid;
begin
  -- ── Who and why, before anything else ────────────────────
  if p_reviewer_id is null then
    raise exception using errcode = '22023', message = 'reviewer_required';
  end if;

  if not exists (select 1 from public.users as u where u.id = p_reviewer_id) then
    raise exception using errcode = 'P0001', message = 'unknown_reviewer';
  end if;

  if v_reason is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;

  if v_decision not in ('promote', 'reject', 'needs_more_evidence') then
    raise exception using errcode = '22023', message = 'invalid_decision';
  end if;

  if v_confidence not in ('medium', 'high') then
    raise exception using errcode = '22023', message = 'invalid_confidence';
  end if;

  if v_domain = '' or v_domain <> p_domain then
    raise exception using errcode = '22023', message = 'invalid_domain';
  end if;

  -- ── The claim under review ──────────────────────────────
  select d.evidence_confidence, d.verified
    into v_before, v_verified
  from public.company_domains as d
  where d.company_id = p_company_id and d.domain = v_domain;

  if v_before is null then
    return query select 'no_claim'::text, v_domain, p_company_id, null::text, false, null::uuid;
    return;
  end if;

  select d.company_id into v_owner_id
  from public.company_domains as d
  where d.domain = v_domain and d.verified and d.company_id <> p_company_id
  limit 1;

  if v_owner_id is not null then
    -- The domain is somebody's proof. A promotion here would only produce a
    -- claim that can never be verified, and the honest route is the operator
    -- reassignment (`reassign_company_domain`), which is a different decision
    -- with a different audit trail.
    return query select 'domain_verified_elsewhere'::text, v_domain, p_company_id,
      v_before, false, null::uuid;
    return;
  end if;

  if v_decision = 'promote' then
    -- A verified claim is already as far as a proof can take it. Rewriting its
    -- confidence (or adding an `operator_review` observation to it) would edit
    -- the state a member's proof produced, which is the one thing a reviewer
    -- must not be able to do. Nothing to promote, nothing to change.
    if v_verified then
      return query select 'already_verified'::text, v_domain, p_company_id, v_before, true, null::uuid;
      return;
    end if;

    if not public.company_domain_evidence_supports_promotion(p_company_id, v_domain) then
      return query select 'needs_evidence'::text, v_domain, p_company_id, v_before, false, null::uuid;
      return;
    end if;

    if v_before = v_confidence and v_before = 'high' then
      return query select 'already_promoted'::text, v_domain, p_company_id, v_before, false, null::uuid;
      return;
    end if;

    v_after := v_confidence;
  else
    -- Rejection and `needs_more_evidence` change no claim: the evidence and the
    -- confidence stay exactly where they were, which is what makes the history
    -- readable afterwards.
    v_after := null;
  end if;

  insert into public.company_domain_reviews (
    domain, company_id, evidence_id, reviewer_id, decision, reason,
    before_confidence, after_confidence
  ) values (
    v_domain, p_company_id, p_evidence_id, p_reviewer_id, v_decision, v_reason,
    v_before, v_after
  )
  on conflict do nothing
  returning id into v_review_id;

  if v_after is not null then
    -- The promotion itself. `verified` is untouched and `verified_at` stays
    -- null: the claim is eligible, not verified.
    update public.company_domains as d
    set evidence_confidence = v_after,
        last_checked_at = now()
    where d.company_id = p_company_id and d.domain = v_domain;

    -- The review IS evidence, so it is recorded like any other observation:
    -- checked, attributable, and of a kind that speaks to corporate mail. If
    -- the promotion is ever revisited, this row is why it happened.
    insert into public.domain_evidence (
      company_id, domain, evidence_type, source_url, source, checked, observed_at
    ) values (
      p_company_id, v_domain, 'operator_review', null, 'operator_review', true, now()
    )
    on conflict do nothing;
  end if;

  return query select
    case when v_decision = 'promote' then 'promoted' else v_decision end,
    v_domain,
    p_company_id,
    coalesce(v_after, v_before),
    false,
    v_review_id;
end;
$$;

comment on function public.review_company_domain(text, uuid, uuid, text, text, text, uuid) is
  'Records an operator decision about a company-domain claim. `promote` lifts the claim''s evidence to high/medium so a proved mailbox can verify it — it never writes `verified` itself, never deletes an observation, and refuses when another company has already proved the domain (reassignment is the path for that). Every decision carries reviewer_id, reason and timestamp.';

revoke all on function public.review_company_domain(text, uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.review_company_domain(text, uuid, uuid, text, text, text, uuid)
  to service_role;
