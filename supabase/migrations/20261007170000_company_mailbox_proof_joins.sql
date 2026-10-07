-- ============================================================
-- Migration: a proved mailbox adds the workplace, always
--
-- WHY
--   Verifying a work email is the one thing the "Where do you work?" flow asks a
--   designer to do: pick the company, receive a code at that company's domain,
--   type it back. Every curated directory row carries an `unknown` or `low`
--   claim, and `confirm_company_verification` read that as "we cannot confirm the
--   domain belongs to this company, so no company was added" — a correct code,
--   and no workplace on the profile. Members did the work and got nothing.
--
-- WHAT CHANGES
--   A correct code always grants the membership and points the profile at the
--   company, whatever the claim's evidence. The DOMAIN is still not verified on
--   weak evidence: `company_domains.verified` stays false, the observation is
--   recorded as `member_domain_control` (true about the mailbox, silent about the
--   mapping), and `company_domain_review_queue()` still offers the claim to an
--   operator, who can promote or reject it on its own merits.
--
--   So the two questions stay separate, which is what the old rule conflated:
--
--     * does this person work here?      the code answers it — membership.
--     * is this company's mail domain
--       really this domain?              evidence answers it — the claim.
--
--   `verified_via` reports which road the member came in by: `own_domain` (the
--   claim met the threshold and the code promoted it), `delegation` (a reviewed
--   delegation), or `mailbox_only` (the weak claim above).
--
-- UNCHANGED, DELIBERATELY
--   * a domain already proved for another company is still `domain_already_
--     verified`, and only a reviewed delegation gets around it;
--   * an OTP observation is still never the evidence that promotes a claim
--     (`company_domain_evidence_supports_promotion` still refuses it), so a
--     reviewer cannot be bypassed by the flow this migration relaxes;
--   * nothing creates a verified domain claim out of a guess.
-- ============================================================


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

        if public.company_confidence_meets_threshold(v_claim_confidence) then
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
        else
          -- ── Below the threshold: the mailbox is still the member's ──────
          -- The claim is weak (a `low` or `unknown` hint — every curated
          -- directory row), so the code may not turn it into the domain's
          -- authority. It still proves the MAILBOX, and the member still works
          -- where that mailbox is: they chose this company from the picker and
          -- answered a code sent to its domain, which is the whole of what
          -- "where do you work?" asked them for.
          --
          -- So the observation is recorded exactly as the truth it is
          -- (`member_domain_control`: true about the mailbox, silent about the
          -- mapping) and the flow continues to the membership and the profile
          -- pointer below. What is NOT granted is the domain:
          -- `company_domains.verified` stays false, so a guess never becomes an
          -- authority over a domain, and an operator still sees this claim in
          -- `company_domain_review_queue()` to promote or reject on its own
          -- merits.
          insert into public.domain_evidence (
            company_id, domain, evidence_type, source_url, source, checked, observed_at
          ) values (
            v_company_id, v_row.domain, 'work_email_otp', null, 'member_domain_control', true, now()
          )
          on conflict do nothing;

          -- `verified_via`: in through the mailbox, not through a proved domain.
          v_via := 'mailbox_only';
        end if;
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
  'Commits a proved work email: creates or resolves the company, claims or promotes the domain, records the membership and points the profile at it. A correct code always grants the membership (verified_via = mailbox_only when the claim is too weak to verify the domain itself); it promotes the claim itself only when the evidence is high or medium, because a mailbox does not prove the directory mapped the domain correctly.';

-- The queue's own description named a status this migration retires. What the
-- queue returns is unchanged — weak claims a member has proved a mailbox on —
-- but such a member is now a member, and the domain question is what is left.
comment on function public.company_domain_review_queue(integer) is
  'Domains where a member proved a mailbox but the claim''s evidence is too weak to verify it (`mailbox_only`: the member joined the company, the domain question is unsettled), with whatever a reviewer needs to decide: the claim''s confidence, the observations, and the last decision. Excludes verified claims and re-surfaces a rejected one only when new evidence has arrived.';


-- ─── Execute grants ─────────────────────────────────────────

-- Re-issued because the DROP above took the function's ACL with it, and a
-- re-created function is EXECUTE-able by PUBLIC by default.

revoke all on function public.confirm_company_verification(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_company_verification(uuid, uuid, text)
  to service_role;
