-- Regression test for the RPC overload ambiguity (production-readiness audit).
--
-- Two overloads of get_community_message_page used to coexist — a 6-argument
-- one and a 7-argument one — and because both had defaulted trailing
-- parameters, a call that omitted `p_content_ids` matched both, so
-- PostgreSQL/PostgREST raised "function ... is not unique".
--
-- This file pins the fix: exactly one overload exists, it is the canonical
-- 7-argument signature, and a six-argument call (relying on the default for
-- `p_content_ids`) resolves cleanly instead of being ambiguous.
--
-- The obsolete function cannot be created here from its own migration (that
-- migration fails on Supabase-only objects — the `auth` schema and friends —
-- see run-local.sh), so the last three assertions recreate the 6-argument
-- overload inline and apply the migration's own drop statement to it. That
-- keeps this file honest about what it proves: not just that only one overload
-- is left, but that the statement removing the other one is the one that does
-- it.
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

-- 2. That overload is the canonical 7-argument function (p_content_ids included).
select is(
  (select p.pronargs::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  7,
  'the remaining overload takes seven arguments (p_content_ids)'
);

-- 3. The invocation that used to be ambiguous now resolves. A six-positional-
--    argument call previously matched both the 6-arg and the (defaulted) 7-arg
--    function; with the obsolete overload gone it must succeed. If a second
--    overload is ever reintroduced this statement errors (42725), failing the
--    whole test file rather than a single assertion — which is the intent.
select ok(
  (select count(*) >= 0
   from public.get_community_message_page(
     '00000000-0000-0000-0000-000000000000'::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid,
     now() - interval '1 day',
     null, null, 50)),
  'a six-argument call resolves to the canonical overload unambiguously'
);

-- 4. Reintroduce the obsolete 6-argument overload so the ambiguity exists
--    again inside this transaction. A trivial body is enough: overload
--    resolution is decided by the signature, never by the body.
create function public.get_community_message_page(
  p_community_id uuid,
  p_viewer_id uuid,
  p_before timestamptz,
  p_after timestamptz,
  p_active_event_starts_at timestamptz,
  p_limit integer
) returns integer language sql as $$ select 0 $$;

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  2,
  'the obsolete 6-argument overload can be reintroduced (two overloads again)'
);

-- 5. The migration's statement — byte for byte — removes exactly that overload.
--    If the migration ever changes shape, this file stops proving the drop.
drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
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

-- 6. ...and leaves the canonical 7-argument function untouched.
select is(
  (select p.pronargs::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_community_message_page'),
  7,
  'the survivor is still the canonical seven-argument function'
);

select * from finish();
rollback;
