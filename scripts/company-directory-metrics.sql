-- ============================================================
-- Company directory: the RUNTIME half of the sample report.
--
-- The generator (`scripts/generate-company-directory-v2.mjs --measure`) answers
-- everything that is a property of the LAYER FILES: how many companies, how many
-- unique domains, how much email-domain evidence exists before anybody signs up.
--
-- It cannot answer questions about what real members did, because those only
-- exist in the database:
--
--   * how many domains are waiting on an operator (`domain_control_only`)
--   * how many domains members have actually proved
--   * how many reviews happened, and how they went
--   * how many verification attempts failed
--
-- This file is that half. It is READ ONLY: no writes, no DDL, no functions
-- called for effect. Safe to run against production, and that is deliberate —
-- the figures a stage report quotes should be reproducible by whoever reads it.
--
--   psql "$DATABASE_URL" -f scripts/company-directory-metrics.sql
--
-- Interpret `verified` as what it means everywhere else: a person proved a
-- mailbox there. `review_promotions` is NOT verification — a promotion only
-- made a claim eligible for one.
-- ============================================================

with
verified_claims as (
  select cd.company_id, cd.domain
  from public.company_domains as cd
  where cd.verified
),
-- A verified claim that ALSO carries a proved-mailbox observation is one a
-- member verified; the same row exists for a claim an older OTP path verified
-- before the threshold shipped, which is why the join is on evidence and not on
-- `source` (the claim keeps the source of the layer that made it).
member_verified as (
  select distinct e.company_id, e.domain
  from public.domain_evidence as e
  where e.evidence_type = 'work_email_otp'
),
claims as (
  select
    count(*)::bigint                                             as claims,
    count(*) filter (where cd.verified)::bigint                   as claims_verified,
    count(*) filter (where not cd.verified)::bigint                as claims_unverified,
    count(*) filter (where cd.evidence_confidence = 'high')::bigint    as claims_high,
    count(*) filter (where cd.evidence_confidence = 'medium')::bigint  as claims_medium,
    count(*) filter (where cd.evidence_confidence = 'low')::bigint     as claims_low,
    count(*) filter (where cd.evidence_confidence = 'unknown')::bigint as claims_unknown,
    count(*) filter (where cd.domain_type = 'primary_website')::bigint as claims_primary_website,
    count(*) filter (where cd.domain_type not in ('primary_website'))::bigint as claims_email_bearing
  from public.company_domains as cd
),
domains as (
  select
    count(*)::bigint                                              as domains,
    count(*) filter (where c > 1)::bigint                         as domains_with_multiple_claims,
    count(*) filter (where v = 1)::bigint                         as domains_verified,
    count(*) filter (where v > 1)::bigint                         as domains_with_multiple_verified_owners
  from (
    select domain, count(*) as c, count(*) filter (where verified) as v
    from public.company_domains
    group by domain
  ) as per_domain
),
observations as (
  select
    count(*) filter (where e.source = 'member_domain_control')::bigint as domain_control_only_events,
    count(distinct (e.company_id, e.domain)) filter (where e.source = 'member_domain_control')::bigint
                                                                        as domains_pending_operator,
    count(*) filter (where e.checked and e.source is distinct from 'member_domain_control')::bigint
                                                                        as checked_company_evidence,
    count(*) filter (where not e.checked)::bigint                       as unchecked_leads
  from public.domain_evidence as e
),
reviews as (
  select
    count(*)::bigint                                                      as reviews,
    count(*) filter (where r.decision = 'promote')::bigint                as promotions,
    count(*) filter (where r.decision = 'reject')::bigint                 as rejections,
    count(*) filter (where r.decision = 'needs_more_evidence')::bigint    as deferred,
    count(distinct r.reviewer_id)::bigint                                 as reviewers
  from public.company_domain_reviews as r
),
challenges as (
  select
    count(*) filter (where v.consumed_at is null and v.expires_at >= now())::bigint as challenges_open,
    count(*) filter (where v.consumed_at is null and v.expires_at < now())::bigint  as verification_failures_expired,
    count(*) filter (where v.consumed_at is not null)::bigint                       as challenges_consumed
  from public.company_email_verifications as v
),
companies as (
  select
    count(*)::bigint                                                                   as companies_total,
    count(*) filter (where c.is_active)::bigint                                        as companies_active,
    count(distinct cd.company_id) filter (where cd.verified)::bigint                    as companies_with_verified_domain,
    count(distinct cd.company_id) filter (where not cd.verified)::bigint                as companies_with_unverified_claims,
    count(*) filter (where c.source_id is not null)::bigint                             as companies_with_registry_identity
  from public.companies as c
  left join public.company_domains as cd on cd.company_id = c.id
),
membership as (
  select
    count(*) filter (where m.verified)::bigint          as verified_memberships,
    count(distinct m.company_id)::bigint                as companies_with_members
  from public.company_members as m
)
select metric, value from (
  select 'companies_total'::text as metric, companies_total::text as value from companies
  union all select 'companies_active', companies_active::text from companies
  union all select 'companies_with_registry_identity', companies_with_registry_identity::text from companies
  union all select 'companies_with_verified_domain', companies_with_verified_domain::text from companies
  union all select 'companies_with_unverified_claims', companies_with_unverified_claims::text from companies
  union all select 'verified_memberships', verified_memberships::text from membership
  union all select 'companies_with_members', companies_with_members::text from membership
  union all select 'domain_claims', claims::text from claims
  union all select 'domain_claims_verified', claims_verified::text from claims
  union all select 'domain_claims_unverified', claims_unverified::text from claims
  union all select 'domain_claims_high', claims_high::text from claims
  union all select 'domain_claims_medium', claims_medium::text from claims
  union all select 'domain_claims_low', claims_low::text from claims
  union all select 'domain_claims_unknown', claims_unknown::text from claims
  union all select 'domain_claims_primary_website', claims_primary_website::text from claims
  union all select 'domain_claims_email_bearing_types', claims_email_bearing::text from claims
  union all select 'unique_domains', domains::text from domains
  union all select 'domains_with_multiple_claims', domains_with_multiple_claims::text from domains
  union all select 'domains_verified', domains_verified::text from domains
  union all select 'domains_with_multiple_verified_owners', domains_with_multiple_verified_owners::text from domains
  union all select 'domains_verified_by_members', (select count(*)::text from member_verified)
  union all select 'domain_control_only_events', domain_control_only_events::text from observations
  union all select 'domains_pending_operator_review', domains_pending_operator::text from observations
  union all select 'checked_company_evidence_rows', checked_company_evidence::text from observations
  union all select 'unchecked_lead_rows', unchecked_leads::text from observations
  union all select 'reviews_total', reviews::text from reviews
  union all select 'review_promotions', promotions::text from reviews
  union all select 'review_rejections', rejections::text from reviews
  union all select 'review_needs_more_evidence', deferred::text from reviews
  union all select 'distinct_reviewers', reviewers::text from reviews
  union all select 'challenges_open', challenges_open::text from challenges
  union all select 'challenges_consumed', challenges_consumed::text from challenges
  union all select 'verification_failures_expired', verification_failures_expired::text from challenges
) as t
order by metric;

-- The queue itself, so the report can name what is waiting rather than only how
-- much: read-only, and capped by the function's own bound.
select
  q.domain,
  q.company_name,
  q.evidence_confidence,
  q.observations,
  q.last_decision,
  q.review_count
from public.company_domain_review_queue(25) as q;
