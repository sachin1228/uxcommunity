-- ============================================================
-- The company-domain review queue
--
-- Migration under test: 20260929152000_company_domain_review.sql, on top of the
-- stewardship model in 20260929150000.
--
-- What these assertions are really guarding:
--
--   * a review decides how strong the EVIDENCE is, never that a company owns a
--     domain: `promote` must leave `verified` false, because only a proved
--     mailbox sets it (see the comment on confirm_company_verification);
--   * the OTP observation that put an item in the queue can never be the
--     evidence that takes it out — `member_domain_control` is refused by the
--     promotion gate, which is the whole point of the queue existing;
--   * a promotion cannot touch a domain another company has already proved
--     (that is a reassignment, a different decision with its own audit trail);
--   * every decision is attributable (reviewer, decision, reason, timestamp) and
--     nothing is ever deleted, so a rejection is an answer that new evidence can
--     overturn rather than a verdict;
--   * the whole path is service-role only.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(40);

-- ─── Fixture ────────────────────────────────────────────────

delete from public.companies where slug in ('revco-a', 'revco-b');
delete from public.users where id in (
  'd0d0d0d0-0000-4000-8000-000000000001',
  'd0d0d0d0-0000-4000-8000-000000000002',
  'd0d0d0d0-0000-4000-8000-000000000003'
);

insert into public.users (id, name, email, password_hash, application_id) values
  ('d0d0d0d0-0000-4000-8000-000000000001', 'Reviewer',  'reviewer@uxc.test', 'x', null),
  ('d0d0d0d0-0000-4000-8000-000000000002', 'Member A',  'ma@reviewco.test',  'x', null),
  ('d0d0d0d0-0000-4000-8000-000000000003', 'Member B',  'mb@rejectme.test',  'x', null);

insert into public.designer_profiles (user_id, experience_level)
select id, 'intermediate' from public.users
where id::text like 'd0d0d0d0-%'
on conflict (user_id) do nothing;

insert into public.companies (id, name, slug) values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'Revco A', 'revco-a'),
  ('d1d1d1d1-0000-4000-8000-000000000002', 'Revco B', 'revco-b');

-- The shapes this queue exists for:
--   reviewco.test  Revco A's claim is `unknown` and a member has proved a
--                  mailbox there -> membership via the mailbox alone
--                  (verified_via = 'mailbox_only'), claim queued for review.
--   rejectme.test  the same shape, used for the rejection path.
--   owned.test     Revco A's claim is weak AND somebody else has PROVED the
--                  domain: promotable? no — that is a reassignment.
insert into public.company_domains
  (company_id, domain, domain_type, evidence_confidence, source, verified, verified_at) values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'reviewco.test', 'primary_website', 'unknown', 'wikidata-p856', false, null),
  ('d1d1d1d1-0000-4000-8000-000000000001', 'rejectme.test', 'primary_website', 'low',     'wikidata-p856', false, null),
  ('d1d1d1d1-0000-4000-8000-000000000001', 'owned.test',    'primary_website', 'low',     'wikidata-p856', false, null),
  ('d1d1d1d1-0000-4000-8000-000000000002', 'owned.test',    'corporate_email', 'medium',  'curated',       true,  now());

-- The observations a member's correct code leaves behind, recorded by
-- confirm_company_verification as source = 'member_domain_control'.
insert into public.domain_evidence
  (company_id, domain, evidence_type, source_url, source, checked, observed_at) values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'reviewco.test', 'work_email_otp', null, 'member_domain_control', true, now()),
  ('d1d1d1d1-0000-4000-8000-000000000001', 'rejectme.test', 'work_email_otp', null, 'member_domain_control', true, now()),
  ('d1d1d1d1-0000-4000-8000-000000000001', 'owned.test',    'work_email_otp', null, 'member_domain_control', true, now());


-- ─── 1. The queue contains exactly what a reviewer can act on ───────────────

select is(
  (select count(*)::int from public.company_domain_review_queue(50) as q
    where q.domain in ('reviewco.test', 'rejectme.test')),
  2,
  'a domain a member proved control of, whose claim is weak, is queued for review'
);

select is(
  (select row(q.domain, q.company_slug, q.evidence_confidence, q.observations,
              q.last_decision, q.review_count)
     from public.company_domain_review_queue(50) as q
    where q.domain = 'reviewco.test'),
  row('reviewco.test'::text, 'revco-a'::text, 'unknown'::text, 1, null::text, 0),
  'the queue carries what a reviewer needs: the claim''s confidence, the observations, the last decision'
);

select is(
  (select count(*)::int from public.company_domain_review_queue(50) as q
    where q.domain = 'owned.test'),
  0,
  'a domain another company has already proved is not a promotion candidate'
);


-- ─── 2. The OTP observation can never promote the claim it created ──────────

select is(
  public.company_domain_evidence_supports_promotion(
    'd1d1d1d1-0000-4000-8000-000000000001', 'reviewco.test'),
  false,
  'a member''s proved mailbox is NOT evidence that the directory''s mapping is right'
);

select is(
  (select status from public.review_company_domain(
    p_domain      => 'reviewco.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'promote',
    p_reason      => 'no supporting evidence on file'
  )),
  'needs_evidence',
  'promoting without checked first-party evidence is refused'
);

select is(
  (select evidence_confidence from public.company_domains
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001' and domain = 'reviewco.test'),
  'unknown',
  'and the refused promotion changed nothing'
);

select is(
  (select count(*)::int from public.company_domain_reviews
    where domain = 'reviewco.test' and decision = 'promote'),
  0,
  'a refused promotion writes no decision row'
);


-- ─── 3. A reviewed, checked source is what lifts the claim ──────────────────

insert into public.domain_evidence
  (company_id, domain, evidence_type, source_url, source, checked, observed_at) values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'reviewco.test', 'first_party_legal_page',
   'https://www.reviewco.test/legal/', 'reviewer', true, now());

select is(
  public.company_domain_evidence_supports_promotion(
    'd1d1d1d1-0000-4000-8000-000000000001', 'reviewco.test'),
  true,
  'a checked first-party page that names the domain is evidence a reviewer may act on'
);

select is(
  (select status from public.review_company_domain(
    p_domain      => 'reviewco.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'promote',
    p_reason      => 'contact page lists careers@reviewco.test for Revco A',
    p_confidence  => 'high'
  )),
  'promoted',
  'the claim is promoted to a confidence a proof may act on'
);

select is(
  (select evidence_confidence from public.company_domains
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001' and domain = 'reviewco.test'),
  'high',
  'the promotion is the claim''s confidence, and only that'
);

select is(
  (select verified from public.company_domains
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001' and domain = 'reviewco.test'),
  false,
  'a promotion never writes `verified`: only a proved mailbox does that'
);

select is(
  (select row(r.reviewer_id, r.decision, r.reason, r.before_confidence, r.after_confidence)
     from public.company_domain_reviews as r where r.domain = 'reviewco.test'),
  row('d0d0d0d0-0000-4000-8000-000000000001'::uuid, 'promote'::text,
      'contact page lists careers@reviewco.test for Revco A'::text, 'unknown'::text, 'high'::text),
  'the decision is attributable: who, what, why, and what the confidence was before and after'
);

select is(
  (select count(*)::int from public.domain_evidence
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001'
      and domain = 'reviewco.test' and evidence_type = 'operator_review'),
  1,
  'the review is recorded as evidence in its own right'
);

select is(
  (select status from public.review_company_domain(
    p_domain      => 'reviewco.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'promote',
    p_reason      => 'promoting an already promoted claim'
  )),
  'already_promoted',
  'promoting what is already promoted is reported rather than repeated'
);


-- ─── 4. And now the mailbox proof does what it is for ───────────────────────

select is(
  (select status from public.confirm_company_verification(
    'd0d0d0d0-0000-4000-8000-000000000002',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'd0d0d0d0-0000-4000-8000-000000000002',
      p_domain     => 'reviewco.test',
      p_work_email => 'ma@reviewco.test',
      p_code_hash  => 'hash-ma',
      p_company_id => 'd1d1d1d1-0000-4000-8000-000000000001'
    )),
    'hash-ma'
  )),
  'verified',
  'after the review, the same mailbox proves the company — the route from a guess to a verified company'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'reviewco.test' and verified),
  1,
  'and the domain still has exactly one verified owner'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001'
      and user_id = 'd0d0d0d0-0000-4000-8000-000000000002' and verified),
  1,
  'the member joins the company they proved'
);

-- And now the claim is finished, so a reviewer cannot touch it: rewriting its
-- confidence or adding an `operator_review` observation would be editing the
-- outcome a member's proof produced, which is the one state a review exists
-- to stay out of.
select is(
  (select status from public.review_company_domain(
    p_domain      => 'reviewco.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'promote',
    p_reason      => 're-promoting a claim a member already proved'
  )),
  'already_verified',
  'a reviewer cannot edit a claim a proved mailbox has already finished'
);

select is(
  (select count(*)::int from public.domain_evidence
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001'
      and domain = 'reviewco.test' and evidence_type = 'operator_review'),
  1,
  'and the refused second review added no observation to the proved claim'
);


-- ─── 5. What a review may not do ───────────────────────────────────────────

select is(
  (select status from public.review_company_domain(
    p_domain      => 'owned.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'promote',
    p_reason      => 'trying to promote a domain somebody else proved'
  )),
  'domain_verified_elsewhere',
  'a review cannot promote a claim on a domain another company has proved'
);

select is(
  (select evidence_confidence from public.company_domains
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001' and domain = 'owned.test'),
  'low',
  'and that refusal changed nothing either'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'owned.test' and verified),
  1,
  'the invariant that a domain has at most one verified owner is untouched'
);

select is(
  (select status from public.review_company_domain(
    p_domain      => 'unclaimed.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'promote',
    p_reason      => 'there is nothing to promote here'
  )),
  'no_claim',
  'a company with no claim on the domain has nothing to promote'
);


-- ─── 6. Rejection is an answer, not a verdict ───────────────────────────────

select is(
  (select status from public.review_company_domain(
    p_domain      => 'rejectme.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'reject',
    p_reason      => 'the mailbox exists but this company does not appear to own the domain'
  )),
  'reject',
  'a rejection is recorded'
);

select is(
  (select evidence_confidence from public.company_domains
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001' and domain = 'rejectme.test'),
  'low',
  'a rejection does not rewrite the claim''s confidence'
);

select is(
  (select count(*)::int from public.domain_evidence
    where company_id = 'd1d1d1d1-0000-4000-8000-000000000001' and domain = 'rejectme.test'),
  1,
  'a rejection deletes no evidence: the observation is still there'
);

select is(
  (select count(*)::int from public.company_domain_review_queue(50) as q
    where q.domain = 'rejectme.test'),
  0,
  'and the item leaves the queue while nothing new is known'
);

insert into public.domain_evidence
  (company_id, domain, evidence_type, source_url, source, checked, observed_at) values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'rejectme.test', 'first_party_contact_page',
   'https://www.rejectme.test/contact', 'resolver', true, now());

select is(
  (select count(*)::int from public.company_domain_review_queue(50) as q
    where q.domain = 'rejectme.test'),
  1,
  'new evidence after a rejection brings the item back: the decision answered the evidence, not the future'
);

select is(
  (select last_decision from public.company_domain_review_queue(50) as q
    where q.domain = 'rejectme.test'),
  'reject',
  'and the queue still shows what the last decision was, so the reviewer sees the history'
);

select is(
  (select status from public.review_company_domain(
    p_domain      => 'rejectme.test',
    p_company_id  => 'd1d1d1d1-0000-4000-8000-000000000001',
    p_reviewer_id => 'd0d0d0d0-0000-4000-8000-000000000001',
    p_decision    => 'needs_more_evidence',
    p_reason      => 'one contact page is not enough to lift this to high'
  )),
  'needs_more_evidence',
  'a reviewer can ask for more evidence instead of deciding'
);

select is(
  (select count(*)::int from public.company_domain_review_queue(50) as q
    where q.domain = 'rejectme.test'),
  1,
  'and the item stays queued until somebody decides'
);

select is(
  (select count(*)::int from public.company_domain_reviews
    where domain = 'rejectme.test'),
  2,
  'every decision is kept: the history is the review table, not a mutable state'
);


-- ─── 7. The queue is not an anonymous door ─────────────────────────────────

select throws_ok(
  $$select public.review_company_domain(
      'reviewco.test', 'd1d1d1d1-0000-4000-8000-000000000001', null, 'promote', 'no reviewer')$$,
  '22023',
  'reviewer-required',
  'a promotion with no reviewer is refused'
);

select throws_ok(
  $$select public.review_company_domain(
      'reviewco.test', 'd1d1d1d1-0000-4000-8000-000000000001',
      'd0d0d0d0-0000-4000-8000-0000000000ff', 'promote', 'not a real user')$$,
  'P0001',
  'unknown-reviewer',
  'and a reviewer that does not exist is refused'
);

select throws_ok(
  $$select public.review_company_domain(
      'reviewco.test', 'd1d1d1d1-0000-4000-8000-000000000001',
      'd0d0d0d0-0000-4000-8000-000000000001', 'maybe', 'not a decision')$$,
  '22023',
  'invalid-decision',
  'only promote / reject / needs_more_evidence are decisions'
);

select throws_ok(
  $$select public.review_company_domain(
      'reviewco.test', 'd1d1d1d1-0000-4000-8000-000000000001',
      'd0d0d0d0-0000-4000-8000-000000000001', 'reject', '  ')$$,
  '22023',
  'reason-required',
  'a decision without a reason is refused'
);

select throws_ok(
  $$insert into public.company_domain_reviews
      (domain, company_id, reviewer_id, decision, reason)
    values ('reviewco.test', 'd1d1d1d1-0000-4000-8000-000000000001',
            'd0d0d0d0-0000-4000-8000-000000000001', 'promote', 'x')$$,
  '23514',
  'reason-length-check',
  'the table itself refuses a one-character reason'
);

select is(
  has_function_privilege('anon', 'public.review_company_domain(text, uuid, uuid, text, text, text, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.review_company_domain(text, uuid, uuid, text, text, text, uuid)', 'execute'),
  false,
  'no client role can review: the decision path is service-role only'
);

select is(
  has_table_privilege('anon', 'public.company_domain_reviews', 'SELECT')
    or has_table_privilege('authenticated', 'public.company_domain_reviews', 'SELECT'),
  false,
  'and the review history is not readable by a client role'
);

select is(
  has_function_privilege('service_role', 'public.review_company_domain(text, uuid, uuid, text, text, text, uuid)', 'execute')
    and has_function_privilege('service_role', 'public.company_domain_review_queue(integer)', 'execute'),
  true,
  'while the service role can both read the queue and decide'
);

select * from finish();
