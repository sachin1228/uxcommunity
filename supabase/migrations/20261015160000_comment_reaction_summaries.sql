-- Comment reactions stop shipping one row per person.
--
-- WHY (measured, see docs/supabase-egress-audit.md §4 #7)
--   Every comment section read its reaction rows and counted them in the app. A
--   reaction row is one `(comment_id, user_id, emoji)`, so what crossed the wire
--   was proportional to how many PEOPLE had reacted rather than to how many emoji
--   are shown: a comment with 2,000 reactions transferred 2,000 rows to draw five
--   pills that say "1,024", "512", "77"… Nothing on a comment ever renders WHO
--   reacted — the pill is a count plus the caller's own highlight
--   (components/communities/CommentSection renders exactly `{ emoji, count,
--   reacted }`) — so the rows were pure waste, and the waste grew with a
--   thread's popularity.
--
-- WHAT
--   One aggregate read for a page of comments. It returns at most one row per
--   (comment, emoji): the group's size, and whether the CALLER is in that group,
--   which is the only per-person fact the UI has ever used. Five emoji are
--   allowed, so a comment costs at most five rows however many people react to
--   it.
--
-- WHY IT RESOLVES ITS OWN TABLE
--   The four comment kinds keep separate reaction tables so each reaction holds a
--   real foreign key (20260923120000_comment_reactions_all_kinds.sql), and that
--   migration creates three of them inside a `do` block — which means a database
--   can legitimately hold `thread_comment_reactions` and nothing else. A function
--   that named all four tables in one query would fail to CREATE on such a
--   database, taking comment reactions away from the kind that IS installed, so
--   the read resolves the one table its `p_kind` names at call time and returns
--   nothing when that table is not there yet — the same answer the app's own read
--   gives today when a kind's table is missing.
--
-- COMPATIBILITY
--   Additive: a new function, nothing dropped or changed. The app's reaction
--   payload (`CommentReactionSummary[]`) is unchanged, so no client sees a
--   difference — and until this migration is applied the TS read falls back to
--   the per-person rows (see lib/communities/comment-reactions.ts).

create or replace function public.get_comment_reaction_summaries(
  p_user_id     uuid,
  -- 'threads' | 'resources' | 'showcase' | 'events'. An unknown kind returns no
  -- rows, like a kind whose table has not been created yet: comments render
  -- without reactions.
  p_kind        text,
  -- One page of comment ids. Null/empty is an empty page, not an error.
  p_comment_ids uuid[]
)
returns table (
  comment_id uuid,
  emoji      text,
  reaction_count bigint,
  reacted    boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- A fixed mapping, never caller-supplied text: `p_kind` selects among four
  -- names and anything else resolves to nothing.
  reaction_table constant text := case p_kind
    when 'threads'   then 'thread_comment_reactions'
    when 'resources' then 'resource_comment_reactions'
    when 'showcase'  then 'showcase_comment_reactions'
    when 'events'    then 'event_comment_reactions'
  end;
  resolved constant regclass :=
    case when reaction_table is null then null
         else pg_catalog.to_regclass('public.' || reaction_table)
    end;
begin
  if resolved is null then
    return;
  end if;

  -- `resolved` is a regclass the database resolved, not a string from the
  -- caller, and the two parameters are bound, so nothing here is interpolated
  -- from input.
  return query execute pg_catalog.format(
    'select r.comment_id, r.emoji, count(*)::bigint, bool_or(r.user_id = $1)'
    ' from %s as r where r.comment_id = any ($2)'
    ' group by r.comment_id, r.emoji',
    resolved
  ) using p_user_id, p_comment_ids;
end $$;

comment on function public.get_comment_reaction_summaries(uuid, text, uuid[]) is
  'Grouped comment reactions for one page of comments: one row per (comment_id, emoji) with the group''s size and whether the caller is in it — the count and the caller''s own state, which is all a comment pill renders. p_kind selects the comment table (threads | resources | showcase | events); an unknown kind, or one whose table has not been created yet, returns no rows.';

revoke all on function public.get_comment_reaction_summaries(uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_comment_reaction_summaries(uuid, text, uuid[]) to service_role;
