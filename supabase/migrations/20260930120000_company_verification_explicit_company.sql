-- ============================================================================
-- Explicit company selection: a proved mailbox is the membership
--
-- What this changes
--   When a member EXPLICITLY selects a company and proves a mailbox on a domain
--   that is registered to that company, the proof now always promotes the claim
--   and creates the membership. The previous behaviour consulted the claim's
--   `evidence_confidence` and, for a `low`/`unknown` claim, answered
--   `domain_control_only` with no membership — which meant the entire bulk
--   directory (every row a guess) could never be verified by the one person who
--   actually holds the mailbox.
--
-- The decision this pins down
--   * The selected company is the verification TARGET. `start_company_
--     verification` already refuses a domain that company does not claim (and a
--     domain another company has proved), so by the time a code exists the
--     (company, domain) pair is one the directory asserts.
--   * The OTP proves control of the mailbox and, with it, the domain. Against
--     an explicitly selected company that is a true statement about the member
--     and the company, not a guess about a mapping — so it is enough.
--   * `evidence_confidence` stays exactly what it was: directory data quality,
--     for discovery, search ranking, review and operator workflows. It no longer
--     gates a member's own proved mailbox.
--
-- What is deliberately NOT changed
--   * A domain already VERIFIED for another company is still refused
--     (`domain_already_verified`), and the partial unique index is still the
--     race boundary.
--   * A company whose claim on the domain does not exist, or a member naming a
--     brand-new company, is still refused at the code (`domain_not_verified`),
--     so a mailbox never invents a company↔domain mapping.
--   * Parent/subsidiary relationships still grant nothing: they are not claims,
--     and verification is never inferred from them.
--   * The import path still cannot touch a verified claim (it updates only
--     `where not d.verified`).
--
-- `domain_control_only` remains a defined status (the resolver, the review queue
-- and the route still know it) but this function no longer returns it: there is
-- no longer a path where a correct code on the selected company's own domain
-- grants nothing.
-- ============================================================================

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
        -- The company's own claim. The member explicitly selected this company
        -- and proved a mailbox on a domain the directory registers for it, so
        -- the proof IS the verification: the claim is promoted regardless of
        -- the `evidence_confidence` the directory assigned it. A `low`/`unknown`
        -- row is a guess only until the mailbox settles it — and refusing here
        -- would leave every bulk-directory company unverifiable by the one
        -- person who actually works there.
        --
        -- The confidence is still read and returned for observability: operators
        -- and the metrics should see what the directory knew when the proof
        -- landed. It just no longer decides anything.
        select d.evidence_confidence into v_claim_confidence
        from public.company_domains as d
        where d.company_id = v_company_id and d.domain = v_row.domain and not d.verified
        order by public.company_confidence_rank(d.evidence_confidence) desc
        limit 1;

        -- The proof is what promotes the claim, and the promotion is where the
        -- race is decided — the partial unique index is the boundary, so a
        -- concurrent proof by another company raises unique_violation, caught
        -- here (it must not roll back the challenge) and answered with
        -- `domain_already_verified` so the member joins that company instead.
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
  'Commits a proved work email: creates or resolves the company, claims or promotes the domain, records the membership and points the profile at it. A proof of a mailbox on a domain registered to an explicitly selected company always promotes that company''s claim and grants the membership; evidence_confidence is directory data quality and no longer gates it. A domain already proved by another company is refused, and naming a new company still cannot spend a domain the directory maps elsewhere.';

revoke all on function public.confirm_company_verification(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_company_verification(uuid, uuid, text) to service_role;
