-- ============================================================
-- R-1 — the design-interests feature is gone
--
-- Migration under test: 20261008140000_remove_design_interests.sql
--
-- Guards the removal itself: the two tables, the 'interest' community type,
-- its communities/settings and the old complete_signup signature must not
-- come back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ─── 1. The tables are gone ─────────────────────────────────

select ok(
  not exists (
    select 1 from pg_tables
    where schemaname = 'public'
      and tablename in ('design_interests', 'user_interests')
  ),
  'design_interests and user_interests are dropped'
);

-- ─── 2. No interest communities remain ──────────────────────

select is(
  (select count(*)::integer from public.communities where type = 'interest'),
  0,
  'no communities of type interest remain'
);

select is(
  (
    select count(*)::integer
    from public.lottie_settings
    where scope = 'type' and scope_key = 'interest'
  ),
  0,
  'no type-scoped lottie setting for interest remains'
);

-- ─── 3. The type cannot be created again ────────────────────

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'communities_type_check'
      and pg_get_constraintdef(oid) not like '%interest%'
  ),
  'communities_type_check no longer allows interest'
);

-- ─── 4. complete_signup lost p_interest_ids ─────────────────

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'complete_signup'
      and pg_get_function_arguments(p.oid) like '%uuid[]%'
  ),
  'complete_signup no longer takes an interest-id array'
);

-- ─── 5. The explore/feed RPCs still exist ───────────────────

select has_function('public', 'get_all_communities', 'get_all_communities still exists');
select has_function('public', 'get_home_feed_page', 'get_home_feed_page still exists');

select * from finish();
rollback;
