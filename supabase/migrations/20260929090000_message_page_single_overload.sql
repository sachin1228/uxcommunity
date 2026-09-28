-- Production-readiness audit (RPC overload ambiguity, separate from M-3):
-- get_community_message_page had TWO live overloads with overlapping defaults:
--
--   6-arg (uuid, uuid, timestamptz, timestamptz, timestamptz, integer)
--   7-arg (uuid, uuid, timestamptz, timestamptz, timestamptz, integer, uuid[])
--
-- `p_before`, `p_after` and `p_limit` all have defaults, so a call that omits
-- `p_content_ids` matches BOTH candidates and PostgreSQL/PostgREST answer with
--   "function public.get_community_message_page(...) is not unique".
--
-- The 6-arg version is obsolete: it predates content-anchored replies and the
-- page-level `content_reactions` payload, and the route's TypeScript contract
-- (apps/web/lib/supabase/performance-rpcs.ts) always passes all seven named
-- arguments. Dropping the 6-arg overload therefore removes the ambiguity
-- without changing the response shape or breaking any caller.
--
-- `drop function` is a DDL metadata change on one function — it does not
-- rewrite or lock the community_messages table.

drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
);
