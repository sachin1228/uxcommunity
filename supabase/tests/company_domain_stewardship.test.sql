-- ============================================================
-- Company domain stewardship — claims, stewards, delegations
--
-- Migrations under test: 20260929150000_company_domain_stewardship.sql and
-- 20260929151000_company_directory_backfill.sql
--
-- The model this file pins down:
--
--   claim        a company says "this is our domain". Several companies may
--                claim one domain, and a claim is EVIDENCE — so two of them
--                disagreeing is data the schema holds, not an error it raises.
--   steward      the resolved owner: a proof decides, otherwise the strongest
--                claim, otherwise the domain is CONTESTED and says so.
--   verified     the one thing a proof sets, and the only uniqueness boundary.
--   delegation   "our staff may prove mailboxes on a domain you steward". It
--                grants no claim and never transfers a domain.
--
-- What the assertions below are really guarding:
--
--   * a relationship (parent/subsidiary/brand) never creates a claim, and never
--     lets Meta's employees verify as WhatsApp or the reverse;
--   * domain verification is refused when another company has proved the
--     domain, and accepted through another company's domain only via a
--     REVIEWED delegation with checked, non-supporting evidence;
--   * MX records and redirects establish nothing;
--   * a weak (low/unknown) claim — the shape the whole 4,574-row directory seed
--     has — never blocks a real company from being created and never reserves a
--     domain, while a medium-or-better one does;
--   * nothing in the import path can mark a domain verified, and no import can
--     downgrade a domain a member has proved.
--
-- Cases A–I are named as in docs/company-directory-architecture.md §6.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(161);

-- ─── Fixture ────────────────────────────────────────────────

-- Committed rows, because the RPCs are SECURITY DEFINER and are called across
-- statements. Slugs and .test domains are unique to this file: the whole suite
-- runs against one database, and company_verified_domains.test.sql has its own
-- fixtures (hintco, reserved-co, …) that must not be disturbed.
delete from public.companies where slug in (
  'meta-platforms', 'facebook', 'instagram', 'whatsapp',
  'weakco', 'conflict-a', 'conflict-b', 'movable-a', 'movable-b',
  'medium-reserved', 'acme-technologies', 'identity-gb', 'identity-us',
  'weak-hint-co'
);
delete from public.users where id in (
  'e0e0e0e0-0000-4000-8000-000000000001',
  'e0e0e0e0-0000-4000-8000-000000000002',
  'e0e0e0e0-0000-4000-8000-000000000003',
  'e0e0e0e0-0000-4000-8000-000000000004',
  'e0e0e0e0-0000-4000-8000-000000000005',
  'e0e0e0e0-0000-4000-8000-000000000006',
  'e0e0e0e0-0000-4000-8000-000000000007',
  'e0e0e0e0-0000-4000-8000-000000000008',
  'e0e0e0e0-0000-4000-8000-000000000009',
  'e0e0e0e0-0000-4000-8000-000000000010',
  'e0e0e0e0-0000-4000-8000-000000000011'
);

insert into public.users (id, name, email, password_hash, application_id) values
  ('e0e0e0e0-0000-4000-8000-000000000001', 'Meta Member',     'm1@meta.test',       'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000002', 'WhatsApp Member', 'w1@whatsapp.test',   'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000003', 'Delegated One',   'w2@whatsapp.test',   'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000004', 'New Co Member',   'a1@weakclaim.test',  'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000005', 'Conflict Member', 'c1@conflict.test',   'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000006', 'Movable Member',  'm2@moveme.test',     'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000007', 'Facebook Member', 'f1@facebook.test',   'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000008', 'Reserved Member', 'r1@mediumreserved.test', 'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000009', 'Earlier Member',  'i1@instagram.test',  'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000010', 'Hint Member',     'l1@lowhint.test',   'x', null),
  ('e0e0e0e0-0000-4000-8000-000000000011', 'Unsure Member',   'u1@unsurehint.test','x', null);

-- `experience_level` is plain text since 20260722_drop_experience_level_enum.sql.
insert into public.designer_profiles (user_id, experience_level)
select id, 'intermediate' from public.users
where id::text like 'e0e0e0e0-%'
on conflict (user_id) do nothing;

-- The four Meta entities, as four companies on four domains, with the
-- relationships between them recorded and NO delegation anywhere: nothing below
-- infers one entity's mail domain from another's ownership.
insert into public.companies (id, name, slug) values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'Meta Platforms',       'meta-platforms'),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'Facebook',             'facebook'),
  ('c1c1c1c1-0000-4000-8000-000000000003', 'Instagram',            'instagram'),
  ('c1c1c1c1-0000-4000-8000-000000000004', 'WhatsApp',             'whatsapp'),
  ('c1c1c1c1-0000-4000-8000-000000000005', 'Weakco Ltd',           'weakco'),
  ('c1c1c1c1-0000-4000-8000-000000000006', 'Conflict A',           'conflict-a'),
  ('c1c1c1c1-0000-4000-8000-000000000007', 'Conflict B',           'conflict-b'),
  ('c1c1c1c1-0000-4000-8000-000000000008', 'Movable A',            'movable-a'),
  ('c1c1c1c1-0000-4000-8000-000000000009', 'Movable B',            'movable-b'),
  ('c1c1c1c1-0000-4000-8000-000000000010', 'Reserved Medium Co',   'medium-reserved'),
  ('c1c1c1c1-0000-4000-8000-000000000011', 'Weak Hint Co',         'weak-hint-co');

-- Claims, at the confidence the evidence behind them deserves. The four Meta
-- entities are medium because a reviewed first-party page backs each one (the
-- evidence rows below); nothing here is 'high', which is reserved for a
-- company's own published mail-domain statement.
--
-- The weak rows are the shape of the whole 4,574-row directory seed: a website
-- guess. They are what the OTP must not be able to promote (section 5).
insert into public.company_domains (company_id, domain, domain_type, evidence_confidence, source) values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'meta.com',            'corporate_email', 'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'facebook.com',        'brand',           'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000003', 'instagram.com',       'brand',           'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000004', 'whatsapp.com',        'corporate_email', 'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000005', 'weakclaim.test',      'primary_website', 'unknown', 'wikidata-p856'),
  ('c1c1c1c1-0000-4000-8000-000000000006', 'conflict.test',       'primary_website', 'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000007', 'conflict.test',       'primary_website', 'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000008', 'moveme.test',         'corporate_email', 'medium',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000010', 'mediumreserved.test', 'corporate_email', 'medium',  'curated'),
  -- Weak Hint Co is the directory: three guessed domains, weakly. (Weakco keeps
  -- its single claim so the assertions about it still describe one thing.)
  ('c1c1c1c1-0000-4000-8000-000000000011', 'lowhint.test',        'corporate_email', 'low',     'wikidata-p856'),
  ('c1c1c1c1-0000-4000-8000-000000000011', 'unknownhint.test',    'primary_website', 'unknown', 'wikidata-p856'),
  ('c1c1c1c1-0000-4000-8000-000000000011', 'contested-weak.test', 'corporate_email', 'low',     'wikidata-p856'),
  -- …and the row for the company that really uses it is the stronger one.
  ('c1c1c1c1-0000-4000-8000-000000000010', 'contested-weak.test', 'corporate_email', 'medium',  'curated');

-- One observed piece of evidence per medium claim, so a medium confidence is
-- never just a number somebody typed.
insert into public.domain_evidence (company_id, domain, evidence_type, source_url, source, checked) values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'meta.com', 'first_party_legal_page',
   'https://www.meta.com/legal/terms/', 'curated', true),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'facebook.com', 'first_party_legal_page',
   'https://www.facebook.com/legal/terms/', 'curated', true),
  ('c1c1c1c1-0000-4000-8000-000000000003', 'instagram.com', 'first_party_legal_page',
   'https://help.instagram.com/581066165581870', 'curated', true),
  ('c1c1c1c1-0000-4000-8000-000000000004', 'whatsapp.com', 'first_party_legal_page',
   'https://www.whatsapp.com/legal/terms-of-service', 'curated', true),
  ('c1c1c1c1-0000-4000-8000-000000000010', 'contested-weak.test', 'first_party_legal_page',
   'https://www.mediumreserved.test/legal/', 'curated', true);

-- Aliases: a search name and a FORMER name are different kinds, which is what
-- keeps "Facebook Inc." from merging the Facebook brand into Meta Platforms.
insert into public.company_aliases (company_id, alias, alias_type, source) values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'Meta',          'alias',       'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000001', 'Facebook Inc.', 'former_name', 'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'Insta',         'alias',       'curated');

insert into public.company_relationships (parent_company_id, child_company_id, relationship_type, source) values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000002', 'brand',       'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000003', 'subsidiary',  'curated'),
  ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000004', 'subsidiary',  'curated');


-- Named differently from the helper in company_verified_domains.test.sql on
-- purpose: that one takes four arguments, and a second overload whose fifth has
-- a default would make every four-argument call ambiguous.
--
-- What it answers: WHY the start was refused. The reason from the exception
-- detail when the refusal has one, and otherwise the message itself (the
-- anti-impersonation and name-taken refusals carry no detail).
create or replace function public.test_domain_refusal_reason(
  p_user_id      uuid,
  p_domain       text,
  p_work_email   text,
  p_company_name text,
  p_company_id   uuid default null
) returns text
language plpgsql
as $$
declare
  v_detail  text;
  v_message text;
begin
  begin
    perform 1 from public.start_company_verification(
      p_user_id      => p_user_id,
      p_domain       => p_domain,
      p_work_email   => p_work_email,
      p_code_hash    => 'hash-reason',
      p_company_id   => p_company_id,
      p_company_name => p_company_name
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail, v_message = message_text;
    if v_detail is not null and v_detail <> '' then
      return coalesce(v_detail::jsonb ->> 'reason', v_message);
    end if;
    return v_message;
  end;
  return null;
end;
$$;


-- ─── 1. The shape of the model ──────────────────────────────

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'companies'
      and column_name in ('country_code', 'industry', 'entity_status', 'source',
                          'source_confidence', 'directory_rank', 'last_checked_at')),
  7,
  'companies carries the registry fields the layers fill in'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'company_domains'
      and column_name in ('domain_type', 'evidence_confidence', 'source', 'first_seen_at', 'last_checked_at')),
  5,
  'a claim carries what KIND of domain it is, how strong the evidence is and where it came from'
);

select is(
  (select count(*)::int from information_schema.tables
    where table_schema = 'public'
      and table_name in ('domain_evidence', 'company_aliases', 'company_relationships', 'company_domain_delegations')),
  4,
  'evidence, aliases, relationships and delegations each have a table'
);

select has_index('public', 'company_domains', 'company_domains_domain_idx',
  'claims are looked up by domain, not only the verified one');

select has_index('public', 'companies', 'companies_active_name_idx',
  'browse has an index matching its ordering');

select has_index('public', 'companies', 'companies_name_trgm_idx',
  'substring name search is index-backed');

select has_index('public', 'company_aliases', 'company_aliases_alias_trgm_idx',
  'substring alias search is index-backed');

select is(
  (select count(*)::int
    from pg_index as i
    join pg_class as t on t.oid = i.indrelid
    join pg_namespace as n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'company_domains'
     and i.indisunique and i.indpred is not null),
  1,
  'the only partial uniqueness on a domain is the verified one'
);

select ok(
  not exists (
    select 1
    from pg_index as i
    join pg_class as t on t.oid = i.indrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'company_domains'
      and i.indisunique
      and i.indpred is null
      and pg_get_indexdef(i.indexrelid) like '%(domain)'
  ),
  'no unique index on unverified claims: several companies may hold evidence about one domain'
);

select throws_ok(
  $$insert into public.companies (name, slug, entity_status) values ('Bad Status', 'bad-status-co', 'sort of active')$$,
  '23514',
  'entity_status-check',
  'entity_status accepts only the documented values'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain, evidence_confidence)
    values ('c1c1c1c1-0000-4000-8000-000000000005', 'checkme.test', 'very sure')$$,
  '23514',
  'confidence-check',
  'evidence_confidence accepts only high/medium/low/unknown'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain, domain_type)
    values ('c1c1c1c1-0000-4000-8000-000000000005', 'checkme.test', 'homepage')$$,
  '23514',
  'domain-type-check',
  'domain_type accepts only the documented kinds'
);

select throws_ok(
  $$insert into public.domain_evidence (company_id, domain, evidence_type)
    values ('c1c1c1c1-0000-4000-8000-000000000005', 'weakclaim.test', 'redirect_from_website')$$,
  '23514',
  'redirect-evidence-refused',
  'a redirect is refused outright: pointing at a company is not a mailbox'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain)
    values ('c1c1c1c1-0000-4000-8000-000000000001', 'meta.com')$$,
  '23505',
  'one-claim-per-company-domain',
  'one company still cannot claim the same domain twice'
);

select throws_ok(
  $$insert into public.company_aliases (company_id, alias, alias_type)
    values ('c1c1c1c1-0000-4000-8000-000000000001', 'Meta Again', 'nickname')$$,
  '23514',
  'alias-type-check',
  'alias_type accepts only the documented kinds'
);

select throws_ok(
  $$insert into public.company_aliases (company_id, alias)
    values ('c1c1c1c1-0000-4000-8000-000000000001', 'Meta')$$,
  '23505',
  'alias-unique-per-company',
  'the same alias cannot be added to one company twice'
);

select throws_ok(
  $$insert into public.company_relationships (parent_company_id, child_company_id, relationship_type)
    values ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000001', 'parent')$$,
  '23514',
  'no-self-relationship',
  'a company cannot be its own parent'
);


-- ─── 2. The resolver: claims, steward, contest, supersede ───

select is(
  (select count(*)::int from public.company_domain_steward('nobody.test')),
  0,
  'a domain nobody claims resolves to no steward'
);

-- The seed's own row for meta.com, plus the curated claim: the stronger claim
-- wins and the domain is not contested, because they do not tie.
select is(
  (select name from public.company_domain_steward('meta.com')),
  'Meta Platforms',
  'the strongest claim is the steward'
);

select is(
  (select evidence_confidence from public.company_domain_steward('meta.com')),
  'medium',
  'the steward reports the confidence it was chosen on'
);

select is(
  (select resolution from public.company_domain_steward('meta.com')),
  'claim',
  'an unproved domain with one best claim resolves as a claim, not a proof'
);

select is(
  (select claim_count from public.company_domain_steward('meta.com')),
  2,
  'both claims on meta.com are visible to the resolver'
);

select is(
  (select contested from public.company_domain_steward('meta.com')),
  false,
  'a stronger claim against a weaker one is not a contest'
);

select is(
  (select resolution from public.company_domain_steward('conflict.test')),
  'contested',
  'two equally strong claims with no proof leave the domain contested'
);

select is(
  (select contested from public.company_domain_steward('conflict.test')),
  true,
  'the contested flag is what tells a caller the answer is a tie'
);

select is(
  (select verified from public.company_domain_steward('conflict.test')),
  false,
  'a contested domain is never reported as verified'
);

select is(
  (select count(*)::int from public.company_domain_claims('conflict.test')),
  2,
  'every claim on a contested domain is listed, none is silently dropped'
);

select is(
  (select count(*)::int from public.company_domain_claims('meta.com') where superseded),
  0,
  'nothing is superseded until somebody proves the domain'
);

select is(
  (select evidence_count from public.company_domain_claims('meta.com') limit 1),
  1::bigint,
  'claims report the observations behind them'
);

select is(
  (select evidence_confidence from public.company_domain_claims('meta.com') limit 1),
  'medium',
  'the claims listing is ordered by strength, so the steward comes first'
);


-- ─── 3. Verification semantics A–I ──────────────────────────

-- A. selected company + its own verified domain → verify as that company.
select is(
  (select count(*)::int from public.start_company_verification(
    p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000001',
    p_domain     => 'meta.com',
    p_work_email => 'm1@meta.com',
    p_code_hash  => 'hash-meta',
    p_company_id => 'c1c1c1c1-0000-4000-8000-000000000001'
  )),
  1,
  'A. a claim of the selected company opens a challenge'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000001',
    (select id from public.company_email_verifications
      where user_id = 'e0e0e0e0-0000-4000-8000-000000000001' and consumed_at is null),
    'hash-meta'
  )),
  'verified',
  'A. the code verifies the domain for the selected company'
);

select is(
  (select resolution from public.company_domain_steward('meta.com')),
  'verified',
  'A. a proof resolves the steward'
);

select is(
  (select count(*)::int from public.company_domain_claims('meta.com') where superseded),
  1,
  'A. the weaker claim is superseded by the proof and KEPT, not deleted'
);

select is(
  (select evidence_type from public.domain_evidence
    where domain = 'meta.com' and evidence_type = 'work_email_otp'),
  'work_email_otp',
  'A. the proof itself is recorded as evidence'
);

select is(
  (select verified_via from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000002',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000002',
      p_domain     => 'whatsapp.com',
      p_work_email => 'w1@whatsapp.com',
      p_code_hash  => 'hash-w1',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000004'
    )),
    'hash-w1'
  )),
  'own_domain',
  'A. verifying on the company''s own domain says so'
);

-- B. selected company + its own unverified claim (a hint) → the proof promotes it.
select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000007',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000007',
      p_domain     => 'facebook.com',
      p_work_email => 'f1@facebook.com',
      p_code_hash  => 'hash-f1',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000002'
    )),
    'hash-f1'
  )),
  'verified',
  'B. a hint of the selected company is promoted by the member''s proof'
);

select is(
  (select verified from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000002' and domain = 'facebook.com'),
  true,
  'B. the promoted claim is the same row, now verified'
);

select throws_ok(
  $$select public.start_company_verification(
      p_user_id      => 'e0e0e0e0-0000-4000-8000-000000000008',
      p_domain       => 'mediumreserved.test',
      p_work_email   => 'r1@mediumreserved.test',
      p_code_hash    => 'hash-r1',
      p_company_name => 'Reserved Medium Two'
    )$$,
  'P0001',
  'H. medium claim reserves',
  'H. a medium-or-better claim blocks a second company for the same domain'
);

select is(
  (select count(*)::int from public.companies where slug = 'reserved-medium-two'),
  0,
  'H. the refusal created no company'
);

-- H. a WEAK claim does not block: the whole 4,574-row directory seed is this
-- shape, and a bad seed must never reserve a domain a real company can prove.
select is(
  (select company_id from public.start_company_verification(
    p_user_id      => 'e0e0e0e0-0000-4000-8000-000000000004',
    p_domain       => 'weakclaim.test',
    p_work_email   => 'a1@weakclaim.test',
    p_code_hash    => 'hash-a1',
    p_company_name => 'Acme Technologies'
  )),
  null::uuid,
  'H. an unknown-confidence claim does not block: a challenge to CREATE opens'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000004',
    (select id from public.company_email_verifications
      where user_id = 'e0e0e0e0-0000-4000-8000-000000000004' and consumed_at is null),
    'hash-a1'
  )),
  'verified',
  'H. the member''s proof creates the company and verifies the domain'
);

select is(
  (select count(*)::int from public.companies where slug = 'acme-technologies'),
  1,
  'H. the real company exists after the proof'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'weakclaim.test' and company_id = 'c1c1c1c1-0000-4000-8000-000000000005'),
  1,
  'H. the weak claim survives as evidence: it was superseded, not deleted'
);

select is(
  (select superseded from public.company_domain_claims('weakclaim.test')
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000005'),
  true,
  'H. the superseded claim says so in the listing'
);

select is(
  (select name from public.company_domain_steward('weakclaim.test')),
  'Acme Technologies',
  'H. the proof decides the steward, not the seed'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000008', 'freshname.test', 'r1@freshname.test',
    'Weakco Ltd'
  ),
  'company_name_taken',
  'H. a name the directory already holds cannot be re-created on another domain'
);

-- F/G. A company with no claim of its own can only use another entity's domain
-- through a reviewed delegation.
select throws_ok(
  $$select public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000003',
      p_domain     => 'meta.com',
      p_work_email => 'w2@meta.com',
      p_code_hash  => 'hash-w2',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000004'
    )$$,
  'P0001',
  'F. parent domain refused for a subsidiary',
  'F. WhatsApp cannot use meta.com just because Meta owns it'
);


-- On a domain nobody has proved, the refusal says the domain is simply not this
-- company's; on one that HAS been proved (meta.com, above) the proof is what
-- refuses, which is the C case asserted next.
select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000003', 'instagram.com', 'w2@instagram.com', null,
    'c1c1c1c1-0000-4000-8000-000000000004'
  ),
  'not_a_company_domain',
  'F. the refusal says the domain is not this company''s, not that it is taken'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000008', 'meta.com', 'r1@meta.com', 'Meta Platforms Copy'
  ),
  'verified',
  'C. a domain somebody has proved is reported as verified'
);

-- C. And the refusal names the owner, so the member can join it.
select is(
  (select c.name
     from public.company_domain_steward('meta.com') as s
     join public.companies as c on c.id = s.company_id
    where s.verified),
  'Meta Platforms',
  'C. the owner is named for the member to join instead'
);

-- Now the delegations. Each one is a different (company, domain) pair, because
-- one company may hold at most one delegation per domain.
insert into public.company_domain_delegations
  (company_id, domain, granted_by, evidence, review_status, reviewed_at) values
  ('c1c1c1c1-0000-4000-8000-000000000003', 'meta.com', 'c1c1c1c1-0000-4000-8000-000000000001',
   '[{"type":"mx_record","checked":true}]', 'reviewed', now()),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'meta.com', 'c1c1c1c1-0000-4000-8000-000000000001',
   '[{"type":"first_party_legal_page","source_url":"https://www.meta.com/legal/","checked":true}]',
   'unreviewed', null),
  ('c1c1c1c1-0000-4000-8000-000000000004', 'facebook.com', 'c1c1c1c1-0000-4000-8000-000000000002',
   '[{"type":"first_party_legal_page","checked":false}]', 'reviewed', now()),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'whatsapp.com', 'c1c1c1c1-0000-4000-8000-000000000001',
   '[{"type":"first_party_legal_page","checked":true}]', 'reviewed', now());

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000003', 'meta.com'),
  false,
  'F. MX evidence alone never establishes that staff use a domain'
);

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000002', 'meta.com'),
  false,
  'F. an unreviewed delegation grants nothing'
);

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000004', 'facebook.com'),
  false,
  'F. evidence nobody has checked grants nothing'
);

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000002', 'whatsapp.com'),
  false,
  'F. a delegation from a company that does not claim the domain grants nothing'
);

select throws_ok(
  $$select public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000003',
      p_domain     => 'meta.com',
      p_work_email => 'w2@meta.com',
      p_code_hash  => 'hash-w2b',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000004'
    )$$,
  'P0001',
  'F. still refused without an effective delegation',
  'F. recording delegations that do not qualify changes nothing'
);

-- The one reviewed, checked, first-party delegation: WhatsApp's staff on Meta's
-- domain. This is the "unless an explicit delegation exists" branch.
insert into public.company_domain_delegations
  (company_id, domain, granted_by, evidence, review_status, reviewed_at) values
  ('c1c1c1c1-0000-4000-8000-000000000004', 'meta.com', 'c1c1c1c1-0000-4000-8000-000000000001',
   '[{"type":"first_party_legal_page","source_url":"https://www.meta.com/legal/","checked":true}]',
   'reviewed', now());

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000004', 'meta.com'),
  true,
  'F. a reviewed delegation with checked first-party evidence is effective'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000003',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000003',
      p_domain     => 'meta.com',
      p_work_email => 'w2@meta.com',
      p_code_hash  => 'hash-w2c',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000004'
    )),
    'hash-w2c'
  )),
  'verified',
  'F. with a delegation the member verifies as their own company'
);

select is(
  (select verified_via from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000008',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000008',
      p_domain     => 'meta.com',
      p_work_email => 'r1@meta.com',
      p_code_hash  => 'hash-r3',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000001'
    )),
    'hash-r3'
  )),
  'own_domain',
  'F. the same domain verified directly is not a delegation'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'meta.com' and verified),
  1,
  'F. a delegation cannot create a second verified claim on a domain'
);

select is(
  (select name from public.company_domain_steward('meta.com')),
  'Meta Platforms',
  'F. the steward keeps the domain: a delegation transfers acceptability, not ownership'
);

select is(
  (select count(*)::int from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000004' and domain = 'meta.com'),
  0,
  'F. the delegated company holds no claim on the steward''s domain'
);

select is(
  (select c.company_id
     from public.get_user_company('e0e0e0e0-0000-4000-8000-000000000003') as c),
  'c1c1c1c1-0000-4000-8000-000000000004'::uuid,
  'F. the delegated member''s profile shows the company they actually work for'
);

-- D. Two equal claims and no proof: the member who proves it becomes the
-- steward, and the rival claim is kept and marked superseded.
select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000005',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000005',
      p_domain     => 'conflict.test',
      p_work_email => 'c1@conflict.test',
      p_code_hash  => 'hash-c1',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000006'
    )),
    'hash-c1'
  )),
  'verified',
  'D. a contested domain can be settled by a member''s proof'
);

select is(
  (select count(*)::int from public.company_domain_claims('conflict.test')),
  2,
  'D. the losing claim is still there afterwards'
);

select is(
  (select claimed_by from (
    select c.name as claimed_by from public.company_domain_claims('conflict.test') as cl
    join public.companies as c on c.id = cl.company_id
    where cl.superseded
  ) as losers),
  'Conflict B',
  'D. the claim that lost is the one that did not prove anything'
);

select is(
  (select resolution from public.company_domain_steward('conflict.test')),
  'verified',
  'D. and the contest is over'
);

-- I. A proved domain whose owner changes: an operator action, never an import.
select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000006',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000006',
      p_domain     => 'moveme.test',
      p_work_email => 'm2@moveme.test',
      p_code_hash  => 'hash-m2',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000008'
    )),
    'hash-m2'
  )),
  'verified',
  'I. a domain is proved by its first company'
);

select is(
  (select status from public.reassign_company_domain(
    'moveme.test',
    'c1c1c1c1-0000-4000-8000-000000000008',
    'c1c1c1c1-0000-4000-8000-000000000009',
    'spun out of Movable A'
  )),
  'reassigned',
  'I. an operator can reassign a proved domain'
);

select is(
  (select verified from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000008' and domain = 'moveme.test'),
  false,
  'I. the old owner is no longer verified'
);

select is(
  (select count(*)::int from public.company_domains where domain = 'moveme.test'),
  2,
  'I. the old claim is kept as history rather than deleted'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000008' and verified),
  1,
  'I. memberships are untouched by a reassignment'
);

select is(
  (select company_id from public.designer_profiles
    where user_id = 'e0e0e0e0-0000-4000-8000-000000000006'),
  'c1c1c1c1-0000-4000-8000-000000000008'::uuid,
  'I. the member''s profile still points where they verified'
);

select is(
  (select verified from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000009' and domain = 'moveme.test'),
  false,
  'I. the new owner has to prove the domain: a reassignment verifies nothing'
);

select is(
  (select evidence_type from public.domain_evidence
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000009'
      and domain = 'moveme.test' and evidence_type = 'operator_reassignment'),
  'operator_reassignment',
  'I. the reassignment is recorded with its reason'
);

select is(
  (select name from public.company_domain_steward('moveme.test')),
  'Movable B',
  'I. the new owner stewards the domain'
);

select is(
  (select retired from public.company_domain_claims('moveme.test')
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000008'),
  true,
  'I. the company that lost the domain keeps its claim, marked retired'
);

select is(
  (select count(*)::int from public.domain_evidence
    where domain = 'moveme.test'
      and company_id = 'c1c1c1c1-0000-4000-8000-000000000008'
      and evidence_type = 'operator_reassignment_retired'),
  1,
  'I. and the retirement is recorded as evidence rather than an edit to the claim'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000009',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000009',
      p_domain     => 'moveme.test',
      p_work_email => 'i1@moveme.test',
      p_code_hash  => 'hash-i1',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000009'
    )),
    'hash-i1'
  )),
  'verified',
  'I. and the new owner can verify it'
);

select is(
  (select status from public.reassign_company_domain(
    'moveme.test',
    'c1c1c1c1-0000-4000-8000-000000000008',
    'c1c1c1c1-0000-4000-8000-000000000009',
    'again'
  )),
  'not_owner',
  'I. a company that no longer owns the domain cannot reassign it'
);

select throws_ok(
  $$select public.reassign_company_domain(
      'meta.com', 'c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000004', '   ')$$,
  '22023',
  'reason-required',
  'I. a reassignment without a reason is refused'
);

select ok(
  not exists (
    select 1 from public.company_domain_claims('meta.com') as cl
    where cl.company_id = 'c1c1c1c1-0000-4000-8000-000000000004'
  ),
  'I. reassignment bookkeeping never invented a claim on meta.com'
);


-- ─── 4. Meta / Facebook / Instagram / WhatsApp, combination by combination ───

-- Four entities, four domains. Each domain is verifiable only by its own
-- company: ownership of one entity by another is not a claim, and the shipped
-- delegation list is empty (the delegation above is a fixture).
select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000001', 'whatsapp.com'),
  false,
  'the parent cannot verify on the subsidiary''s domain'
);

select is(
  (select count(*)::int from public.company_relationships
    where parent_company_id = 'c1c1c1c1-0000-4000-8000-000000000001'),
  3,
  'the three relationships are recorded'
);

select is(
  (select count(*)::int from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000001'
      and domain in ('facebook.com', 'instagram.com', 'whatsapp.com')),
  0,
  'a parent/subsidiary relationship creates no claim for the parent'
);

select is(
  (select count(*)::int from public.company_domains
    where company_id in ('c1c1c1c1-0000-4000-8000-000000000002',
                         'c1c1c1c1-0000-4000-8000-000000000003',
                         'c1c1c1c1-0000-4000-8000-000000000004')
      and domain = 'meta.com'),
  0,
  'no subsidiary holds a claim on the parent''s domain, whatever its delegation'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000003', 'instagram.com', 'w2@instagram.com', null,
    'c1c1c1c1-0000-4000-8000-000000000004'
  ),
  'not_a_company_domain',
  'WhatsApp + instagram.com is refused'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000003', 'facebook.com', 'w2@facebook.com', null,
    'c1c1c1c1-0000-4000-8000-000000000004'
  ),
  'verified',
  'WhatsApp + facebook.com is refused, and the reason is Facebook''s own proof'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000007', 'instagram.com', 'f1@instagram.com', null,
    'c1c1c1c1-0000-4000-8000-000000000002'
  ),
  'not_a_company_domain',
  'Facebook + instagram.com is refused'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000007', 'whatsapp.com', 'f1@whatsapp.com', null,
    'c1c1c1c1-0000-4000-8000-000000000002'
  ),
  'verified',
  'Facebook + whatsapp.com is refused: a brand does not inherit a proved domain'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000009', 'facebook.com', 'i1@facebook.com', null,
    'c1c1c1c1-0000-4000-8000-000000000003'
  ),
  'verified',
  'Instagram + facebook.com is refused'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000001', 'whatsapp.com', 'm1@whatsapp.com', null,
    'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  'verified',
  'Meta + whatsapp.com is refused: owning the company is not owning the domain'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000001', 'instagram.com', 'm1@instagram.com', null,
    'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  'not_a_company_domain',
  'Meta + instagram.com is refused'
);

select is(
  public.test_domain_refusal_reason(
    'e0e0e0e0-0000-4000-8000-000000000001', 'facebook.com', 'm1@facebook.com', null,
    'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  'verified',
  'Meta + facebook.com is refused'
);

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000003', 'meta.com'),
  false,
  'Instagram has no delegation to meta.com either'
);

select is(
  public.company_domain_delegation_allowed('c1c1c1c1-0000-4000-8000-000000000002', 'meta.com'),
  false,
  'Facebook has no effective delegation to meta.com'
);

select is(
  (select c.slug
     from public.search_companies('Meta', 25) as s
     join public.companies as c on c.id = s.id
    where c.slug = 'meta-platforms'),
  'meta-platforms',
  'Meta Platforms is found by its alias'
);

select is(
  (select count(*)::int from public.companies as c
    where c.slug = 'facebook'),
  1,
  'the Facebook brand stays its own searchable entity'
);


-- ─── 5. Weak claims: searchable evidence, never a routing decision ──────────

select is(
  (select verified from public.search_companies('Weakco')),
  false,
  'a company whose only claim is unknown confidence is never shown as verified'
);

select is(
  (select evidence_confidence from public.search_companies('Weakco')),
  'unknown',
  'search reports how strong the claim behind the domain is'
);

select is(
  (select count(*)::int from public.search_companies('mediumreserved.test')),
  0,
  'an unproved domain never answers a domain search'
);

select is(
  (select verified from public.company_domain_owner('mediumreserved.test')),
  false,
  'the routing lookup returns a hint unverified, so nothing follows it automatically'
);

select is(
  (select count(*)::int from public.company_domain_owner('nobody.test')),
  0,
  'an unknown domain routes nowhere at all'
);


-- ─── 5b. A correct code on a WEAK claim grants no company ───────────────────

-- The failure mode this guards: the directory guesses that lowhint.test belongs
-- to Weakco Ltd. Somebody with a lowhint.test mailbox selects Weakco Ltd and
-- enters the code we really did send them. OTP proves the MAILBOX; it cannot
-- prove that the directory's company-to-domain mapping is right — and if it
-- could, then every wrong seed row would become a verified company by the first
-- person to sign up at that domain.

select ok(
  public.company_confidence_meets_threshold('medium')
    and public.company_confidence_meets_threshold('high')
    and not public.company_confidence_meets_threshold('low')
    and not public.company_confidence_meets_threshold('unknown'),
  'the threshold that decides promotion is exactly high/medium'
);

select is(
  (select count(*)::int from public.start_company_verification(
    p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000010',
    p_domain     => 'lowhint.test',
    p_work_email => 'l1@lowhint.test',
    p_code_hash  => 'hash-l1',
    p_company_id => 'c1c1c1c1-0000-4000-8000-000000000011'
  )),
  1,
  'a low claim is selectable: the challenge opens, because a guess is evidence you may act on'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000010',
    (select id from public.company_email_verifications
      where user_id = 'e0e0e0e0-0000-4000-8000-000000000010' and consumed_at is null),
    'hash-l1'
  )),
  'domain_control_only',
  'the correct code on a low claim is recorded as domain control, not company ownership'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'lowhint.test' and verified),
  0,
  'no verified claim was created on the guessed domain'
);

select is(
  (select count(*)::int from public.company_members
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000011'
      and user_id = 'e0e0e0e0-0000-4000-8000-000000000010'),
  0,
  'and no membership: a mailbox is not an employer'
);

select is(
  (select company_id from public.designer_profiles
    where user_id = 'e0e0e0e0-0000-4000-8000-000000000010'),
  null::uuid,
  'and the profile was not pointed at the company'
);

select is(
  (select source from public.domain_evidence
    where domain = 'lowhint.test' and evidence_type = 'work_email_otp'
      and company_id = 'c1c1c1c1-0000-4000-8000-000000000011'),
  'member_domain_control',
  'what the member proved is recorded as evidence, attributed to what it actually shows'
);

select is(
  (select resolution from public.company_domain_steward('lowhint.test')),
  'claim',
  'and it does not lift the claim: domain-control evidence is deliberately excluded from the resolver'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000010',
    (select id from public.company_email_verifications
      where user_id = 'e0e0e0e0-0000-4000-8000-000000000010'
      order by created_at desc limit 1),
    'hash-l1'
  )),
  'already_used',
  'the challenge is spent even though nothing was granted, so the mailbox cannot be replayed'
);


-- An `unknown` claim is the same story with even less behind it.
select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000011',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000011',
      p_domain     => 'unknownhint.test',
      p_work_email => 'u1@unknownhint.test',
      p_code_hash  => 'hash-u1',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000011'
    )),
    'hash-u1'
  )),
  'domain_control_only',
  'an unknown claim cannot be promoted either'
);

select is(
  (select count(*)::int from public.company_domains
    where domain = 'unknownhint.test' and verified),
  0,
  'and it stays unverified'
);

-- The same domain, claimed weakly by the directory and correctly by the company
-- that really uses it. The member on the weak side gets domain control only; the
-- member on the strong side verifies. This is the "A guessed abc.com, B uses
-- abc.com" case from the architecture review.
select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000011',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000011',
      p_domain     => 'contested-weak.test',
      p_work_email => 'u1@contested-weak.test',
      p_code_hash  => 'hash-u2',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000011'
    )),
    'hash-u2'
  )),
  'domain_control_only',
  'the weak claimant cannot take a domain another company has better evidence for'
);

select is(
  (select name from public.company_domain_steward('contested-weak.test')),
  'Reserved Medium Co',
  'the stronger claim is the steward while nobody has proved anything'
);

select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000008',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000008',
      p_domain     => 'contested-weak.test',
      p_work_email => 'r1@contested-weak.test',
      p_code_hash  => 'hash-r4',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000010'
    )),
    'hash-r4'
  )),
  'verified',
  'the company with the stronger claim proves it and becomes the owner'
);

select is(
  (select count(*)::int from public.company_domain_claims('contested-weak.test')),
  2,
  'the losing hint is still a row: supersession is derived, never a delete'
);

select is(
  (select evidence_confidence from public.company_domain_claims('contested-weak.test')
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000011'),
  'low',
  'and it keeps its own confidence: the proof decided the domain, it did not rewrite the evidence'
);

select is(
  (select superseded from public.company_domain_claims('contested-weak.test')
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000011'),
  true,
  'the hint is marked superseded rather than removed'
);

-- The challenge still opens for a company that holds a claim of its own — the
-- member may legitimately be checking their own mailbox — and the refusal lands
-- where the decision is: at the code. The company that holds no claim on the
-- now-proved domain cannot end up verified on it, whatever the code proves.
select is(
  (select status from public.confirm_company_verification(
    'e0e0e0e0-0000-4000-8000-000000000010',
    (select verification_id from public.start_company_verification(
      p_user_id    => 'e0e0e0e0-0000-4000-8000-000000000010',
      p_domain     => 'contested-weak.test',
      p_work_email => 'l1@contested-weak.test',
      p_code_hash  => 'hash-l2',
      p_company_id => 'c1c1c1c1-0000-4000-8000-000000000011'
    )),
    'hash-l2'
  )),
  'domain_already_verified',
  'and once the domain is somebody else''s proof, the weak claimant is refused at the code'
);

select is(
  (select count(*)::int from public.search_companies('contested-weak.test')),
  1,
  'the proved domain answers a domain search exactly once'
);

select is(
  (select verified from public.search_companies('contested-weak.test')),
  true,
  'and only for the company that proved it'
);


-- ─── 6. Search: one index-backed arm per way in ─────────────────────────────

select ok(
  (select count(*) from public.search_companies('', 25)) > 0,
  'an empty query browses the directory'
);

select is(
  (select count(*)::int from public.search_companies('Zzzzzz', 25)),
  0,
  'a term nobody matches returns nothing rather than everything'
);

select is(
  (select c.slug from public.search_companies('Weakco') as s
    join public.companies as c on c.id = s.id limit 1),
  'weakco',
  'a substring name search finds the company'
);

select is(
  (select count(*)::int from public.search_companies('zz') as s
    join public.companies as c on c.id = s.id
   where not (lower(c.name) like 'zz%'
              or c.slug like 'zz%'
              or exists (select 1 from public.company_domains as d
                          where d.company_id = c.id and d.domain like 'zz%'))),
  0,
  'a two-character term is a PREFIX search: nothing that merely contains it is returned'
);

select is(
  (select c.slug from public.search_companies('Insta') as s
    join public.companies as c on c.id = s.id where c.slug = 'facebook'),
  'facebook',
  'an alias matches'
);

select is(
  (select count(*)::int from public.search_companies('Insta') as s
    join public.companies as c on c.id = s.id where c.slug = 'meta-platforms'),
  0,
  'a former name is a search name, and an alias is not a wildcard'
);

select is(
  (select c.slug from public.search_companies('meta.c') as s
    join public.companies as c on c.id = s.id where c.slug = 'meta-platforms'),
  'meta-platforms',
  'a verified domain prefix finds its company'
);

select is(
  (select count(*)::int from public.search_companies('weakclaim.test')),
  1,
  'once proved, a domain answers a domain search — and only for its prover'
);

select is(
  (select verified from public.search_companies('acme-tech') where domain = 'weakclaim.test'),
  true,
  'the proving company answers for the domain instead'
);

select is(
  (select count(*)::int from public.search_companies('%', 25)),
  0,
  'a LIKE wildcard is escaped: it searches for a literal percent sign'
);

select ok(
  (select count(*) from public.search_companies('a', 100)) <= 25,
  'the result cap holds however large the limit asked for'
);


-- ─── 7. Domain data quality ─────────────────────────────────────────────────

insert into public.company_domains (company_id, domain, domain_type, evidence_confidence)
values ('c1c1c1c1-0000-4000-8000-000000000005', 'weakco.de', 'regional', 'low');

select is(
  (select count(*)::int from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000005'),
  2,
  'a bare country-code domain is a valid claim: the generator bug that dropped every one of them stays fixed'
);

select is(
  (select domain_type from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000005' and domain = 'weakco.de'),
  'regional',
  'and it can be typed as the regional domain it is'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain)
    values ('c1c1c1c1-0000-4000-8000-000000000005', 'Weakco.DE')$$,
  '23514',
  'domains-stored-normalised',
  'an unnormalised domain is rejected, so one domain cannot become two rows'
);

insert into public.company_domains (company_id, domain)
values ('c1c1c1c1-0000-4000-8000-000000000005', 'typed-later.test');

select is(
  (select domain_type from public.company_domains
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000005' and domain = 'typed-later.test'),
  'primary_website',
  'a claim whose kind nobody stated is a website, never an email domain'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain, verified, verified_at)
    values ('c1c1c1c1-0000-4000-8000-000000000005', 'unproved.test', false, now())$$,
  '23514',
  'unverified-has-no-timestamp',
  'an unverified claim never carries a verification timestamp'
);

select throws_ok(
  $$insert into public.company_domains (company_id, domain, verified, verified_at)
    values ('c1c1c1c1-0000-4000-8000-000000000005', 'meta.com', true, now())$$,
  '23505',
  'one-verified-owner-per-domain',
  'a second company cannot end up verified on a proved domain'
);

select is(
  (select count(*)::int from public.domain_evidence
    where domain = 'meta.com' and evidence_type = 'first_party_legal_page'),
  1,
  'evidence rows are per observation and are not duplicated'
);

select throws_ok(
  $$insert into public.domain_evidence (company_id, domain, evidence_type, source_url)
    values ('c1c1c1c1-0000-4000-8000-000000000001', 'meta.com', 'first_party_legal_page',
            'https://www.meta.com/legal/terms/')$$,
  '23505',
  'same-observation-once',
  'the same observation is recorded once'
);

select is(
  (select count(*)::int from public.company_relationships
    where child_company_id = 'c1c1c1c1-0000-4000-8000-000000000004'
      and relationship_type = 'subsidiary'),
  1,
  'WhatsApp is recorded as a subsidiary'
);

select is(
  (select alias_type from public.company_aliases
    where company_id = 'c1c1c1c1-0000-4000-8000-000000000001' and alias = 'Facebook Inc.'),
  'former_name',
  'a former name is typed as one, so it can never merge two entities'
);


-- ─── 8. The backfill: attributes, never verifies, never downgrades ──────────

-- The same statement shape as 20260929151000 with a two-domain list, so the
-- guards under test are the ones the migration uses. `backfill-weak.test` is an
-- unverified null-source claim; `moveme.test` has just been re-proved by its
-- new owner, so it is verified and must be left exactly as it is.
insert into public.company_domains (company_id, domain, evidence_confidence)
values ('c1c1c1c1-0000-4000-8000-000000000011', 'backfill-weak.test', 'unknown');

create temporary table test_backfill_domain (domain text primary key);
insert into test_backfill_domain values ('backfill-weak.test'), ('moveme.test');

with seeded(domain) as (
  select domain from test_backfill_domain
),
attributed as (
  update public.company_domains as d
  set domain_type = 'primary_website',
      evidence_confidence = 'unknown',
      source = 'wikidata-p856'
  from seeded as s
  where d.domain = s.domain
    and d.source is null
    and not d.verified
  returning d.company_id
)
select count(*)::int as attributed_count from attributed;

select is(
  (select source from public.company_domains where domain = 'backfill-weak.test'),
  'wikidata-p856',
  'the backfill attributes an unverified claim that has no source'
);

select is(
  (select source from public.company_domains
    where domain = 'moveme.test' and company_id = 'c1c1c1c1-0000-4000-8000-000000000009'),
  'operator_reassignment',
  'the backfill leaves a proved claim''s provenance exactly as it was'
);

select is(
  (select verified from public.company_domains
    where domain = 'moveme.test' and company_id = 'c1c1c1c1-0000-4000-8000-000000000009'),
  true,
  'and it cannot un-verify one either'
);

with seeded(domain) as (
  select domain from test_backfill_domain
),
attributed as (
  update public.company_domains as d
  set domain_type = 'primary_website',
      evidence_confidence = 'unknown',
      source = 'wikidata-p856'
  from seeded as s
  where d.domain = s.domain
    and d.source is null
    and not d.verified
  returning d.company_id
)
select is(
  (select count(*)::int from attributed),
  0,
  're-running the backfill changes nothing: it is idempotent'
);

-- The same statement a third time, with every proved row snapshotted first: a
-- backfill that runs on a schedule must not be able to walk a proof backwards.
create temporary table test_verified_before as
  select id from public.company_domains where verified;

with seeded(domain) as (
  select domain from test_backfill_domain
),
attributed as (
  update public.company_domains as d
  set domain_type = 'primary_website',
      evidence_confidence = 'unknown',
      source = 'wikidata-p856'
  from seeded as s
  where d.domain = s.domain
    and d.source is null
    and not d.verified
  returning d.company_id
)
select is(
  (select count(*)::int from attributed),
  0,
  'a third run of the backfill still changes nothing'
);

select is(
  (select count(*)::int from test_verified_before as b
    join public.company_domains as d on d.id = b.id
   where not d.verified),
  0,
  'and not one proved domain was downgraded by it, however many times it runs'
);


-- ─── 9. Entity identity: a registry number, not a name ──────────────────────

-- `source` + `source_id` + `jurisdiction` is what a registry assigns. A name is
-- not an identity: two companies with the same name in two countries are two
-- companies, and the schema has to make that the cheap case rather than the one
-- that silently merges.
select is(
  (select count(*)::int from pg_index as i
    join pg_class as t on t.oid = i.indrelid
    join pg_namespace as n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'companies'
     and i.indisunique
     and pg_get_indexdef(i.indexrelid) like '%(source, source_id)%'
     and i.indpred is not null),
  1,
  'a registry identity is unique where a registry actually supplied one'
);

select ok(
  not exists (
    select 1
    from pg_index as i
    join pg_class as t on t.oid = i.indrelid
    join pg_namespace as n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'companies'
      and i.indisunique
      and i.indpred is null
      and pg_get_indexdef(i.indexrelid) like '%(name)%'
  ),
  'and no unique index on a company name: names are shared'
);

insert into public.companies (name, slug, country_code, jurisdiction, source, source_id) values
  ('Nordic Holdings Ltd', 'identity-gb', 'GB', 'GB', 'test-registry', '00000001'),
  ('Nordic Holdings Ltd', 'identity-us', 'US', 'US-DE', 'test-registry', '00000002');

select is(
  (select count(*)::int from public.companies where name = 'Nordic Holdings Ltd'),
  2,
  'two same-named companies in two jurisdictions are two rows, not one merge'
);

select throws_ok(
  $$insert into public.companies (name, slug, country_code, jurisdiction, source, source_id)
    values ('Nordic Holdings (duplicate row)', 'identity-gb-again', 'GB', 'GB', 'test-registry', '00000001')$$,
  '23505',
  'companies_source_identity_idx',
  'the same legal entity cannot be inserted twice under a second name'
);

select is(
  (select count(*)::int from public.companies
    where slug = 'identity-gb-again'),
  0,
  'and the refused row left nothing behind'
);

select * from finish();
