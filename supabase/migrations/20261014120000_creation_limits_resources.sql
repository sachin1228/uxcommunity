-- ============================================================
-- Creation limits — resources join the shared daily post budget
-- ============================================================
-- Follow-up to 20261013120000_creation_limits.sql (already applied):
-- community resources are posts too. Sharing one now spends the same
-- 3-a-day budget as threads and showcase posts — same kind
-- ('posts_daily'), same referee, same append-only rules (deleting a
-- resource does not refund it; deleting a community does not either —
-- the resource rows go with it but the counter stays).
--
-- The trigger reuses enforce_post_creation_limit(), so there is still
-- exactly one place that defines "a post" for the budget.
--
-- Backfill: recomputes today's posts_daily from the source tables
-- (threads + showcase + resources) and keeps the GREATER of stored and
-- recomputed count. That makes the file idempotent on re-run: it can
-- never double-count, and it can never LOWER a counter that an earlier
-- refused attempt or a since-deleted post legitimately accrued.
-- ============================================================

drop trigger if exists trg_community_resources_creation_limit on public.community_resources;
create trigger trg_community_resources_creation_limit
  before insert on public.community_resources
  for each row execute function public.enforce_post_creation_limit();

comment on function public.enforce_post_creation_limit() is
  'Threads, showcase posts and resources share one daily budget — 3 posts a day across the whole app.';

insert into public.usage_counters as uc (user_id, kind, period_key, count)
select t.user_id,
       'posts_daily',
       to_char((now() at time zone 'utc'), 'YYYY-MM-DD'),
       count(*)
  from (
    select ct.user_id
      from public.community_threads as ct
     where ct.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    union all
    select cs.user_id
      from public.community_showcase_posts as cs
     where cs.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    union all
    select cr.user_id
      from public.community_resources as cr
     where cr.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
  ) as t
 group by t.user_id
on conflict (user_id, kind, period_key) do update
  set count      = greatest(uc.count, excluded.count),
      updated_at = now();
