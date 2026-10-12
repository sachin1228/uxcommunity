-- Regression test for the RPC overload ambiguity (production-readiness audit).
--
-- Two overloads of get_community_message_page used to coexist — a 6-argument
-- one and a 7-argument one — and because both had defaulted trailing
-- parameters, a call that omitted `p_content_ids` matched both, so
-- PostgreSQL/PostgREST raised "function ... is not unique".
--
-- This file pins the fix: exactly one overload exists, and a call that relies
-- on defaults for the trailing parameters resolves cleanly instead of being
-- ambiguous. The canonical signature has since grown the compound cursor
-- halves (20261013100000_community_message_compound_cursor), so it is the
-- NINE-argument function that must be the single survivor; the previous
-- seven-argument signature is what that migration drops.
--
-- Obsolete signatures cannot be created here from their own migrations (those
-- fail on Supabase-only objects — the `auth` schema and friends — see
-- run-local.sh), so this file recreates the obsolete 7-argument overload
-- inline and applies the migration's drop statement to it. That keeps this
-- file honest about what it proves: not just that only one overload is left,
-- but that the statement removing the other one is the one that does it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- 1. Exactly one overload remains.
select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  1,
  'get_community_message_page exposes exactly one overload'
);

-- 2. That overload is the canonical 9-argument function (p_content_ids plus
--    the two compound-cursor id halves).
select is(
  (select p.pronargs::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  9,
  'the remaining overload takes nine arguments (p_content_ids + cursor halves)'
);

-- 3. The invocation that used to be ambiguous now resolves, and keeps working
--    while the signature grows: a six-positional-argument call previously
--    matched both the 6-arg and the (defaulted) 7-arg function, and now matches
--    the (defaulted) 9-arg one. This is also what an already-deployed older
--    build sends during a staged deploy. If a second overload is ever
--    reintroduced this statement errors (42725), failing the whole test file
--    rather than a single assertion — which is the intent.
select ok(
  (select count(*) >= 0
   from public.get_community_message_page(
     '00000000-0000-0000-0000-000000000000'::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid,
     now() - interval '1 day',
     null, null, 50)),
  'a six-argument call resolves to the canonical overload unambiguously'
);

-- 4. Reintroduce the obsolete 7-argument overload so the ambiguity exists
--    again inside this transaction. A trivial body is enough: overload
--    resolution is decided by the signature, never by the body.
create function public.get_community_message_page(
  p_community_id uuid,
  p_user_id uuid,
  p_history_start timestamptz,
  p_before timestamptz,
  p_after timestamptz,
  p_limit integer,
  p_content_ids uuid[]
) returns integer language sql as $$ select 0 $$;

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  2,
  'the obsolete 7-argument overload can be reintroduced (two overloads again)'
);

-- 5. The migration's statement — byte for byte — removes exactly that overload.
--    If the migration ever changes shape, this file stops proving the drop.
drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[]
);

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  1,
  'the migration drop statement removes the 6-argument overload'
);

-- 6. ...and leaves the canonical 9-argument function untouched.
select is(
  (select p.pronargs::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  9,
  'the survivor is still the canonical nine-argument function'
);

select * from finish();
rollback;
