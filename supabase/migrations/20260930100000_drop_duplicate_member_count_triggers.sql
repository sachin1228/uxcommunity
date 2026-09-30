-- ============================================================
-- Schema drift — duplicate member-count trigger stack on community_members
--
-- SYMPTOM
-- Every community page showed a member count about double its real
-- membership: the chat header said "4 members" and the right sidebar
-- "Members (4)" while the Members tab listed 2 rows and ended with
-- "2 members total" (screenshot, 2026-09-30). The same +1..+2 drift
-- showed in the left sidebar and on the other communities.
--
-- WHY
-- get_community_members_page (20260928120000) reports `total` from the
-- materialized counter communities.member_count (20260927120000), so the
-- Members tab showed the true 2 — but every other surface (sidebar
-- projection, Explore, community meta, create/join responses) reads the
-- counter too, and the counter had drifted.
--
-- The live project carried a SECOND counter stack on community_members
-- alongside the migration's own:
--
--   community_members_increment_count  AFTER INSERT
--   community_members_decrement_count  AFTER DELETE
--     → update_community_member_count()
--
-- Neither the triggers nor the function exist anywhere in this repo or its
-- git history: they were applied to the project by hand (the same shape of
-- drift 20260926010000_schema_drift_missing_columns.sql captured for
-- columns). With both stacks installed every membership write moved the
-- counter twice:
--
--   join  → sync (+1) + rogue (+1) = +2
--   leave → sync (−1) + rogue (−1) = −2
--
-- iasiso: owner membership + one join = 2 rows × 2 triggers = 4, which is
-- exactly what the UI showed. (Cascade deletions only moved it once, which
-- is why Gurugram Designers ended up at 0 with one member.)
--
-- WHAT
-- 1. Drop the two rogue triggers and the now-unreferenced function. The
--    repo's own trg_community_members_count* / sync_community_member_count()
--    stack stays: it is the maintained one (SECURITY DEFINER with an empty
--    search_path, verified by supabase/tests/member_count.test.sql).
-- 2. Re-run the C-1 backfill verbatim so every drifted counter returns to
--    the exact number of community_members rows. `is distinct from` makes
--    re-running a no-op.
-- ============================================================


-- ─── 1. Remove the duplicate stack ──────────────────────────
-- `if exists` keeps this re-runnable and no-ops on any project that never
-- received the hand-applied triggers (a fresh build from this directory has
-- only the migration-owned pair).

drop trigger if exists community_members_increment_count on public.community_members;
drop trigger if exists community_members_decrement_count on public.community_members;

-- Only the rogue pair referenced this function (the repo's triggers call
-- sync_community_member_count), so it has no callers left.
drop function if exists public.update_community_member_count();


-- ─── 2. Reconcile the drifted counters ──────────────────────
-- Step 2 of 20260927120000_community_member_count.sql, verbatim: one pass
-- over the communities that are actually wrong.

update public.communities as c
set member_count = coalesce(counted.total, 0)
from (
  select community.id,
         count(member.user_id)::integer as total
  from public.communities as community
  left join public.community_members as member
    on member.community_id = community.id
  group by community.id
) as counted
where counted.id = c.id
  and c.member_count is distinct from coalesce(counted.total, 0);
