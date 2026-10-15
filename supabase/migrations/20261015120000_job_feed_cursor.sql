-- Keyset pagination for the jobs feed.
--
-- get_job_feed gains a compound (created_at, id) cursor — the same shape the
-- threads / resources / showcase lists already page with. Pages beyond the
-- first pass the last row's pair as p_before_created_at / p_before_id and the
-- function returns only strictly older rows, so a posting cannot be skipped
-- or repeated while the board pages (a timestamp-only cursor would skip rows
-- that share a boundary instant).
--
-- Everything else is the body from 20261009180000_job_expiry.sql: a posting
-- that is not accepting applications — closed by its owner or past its
-- deadline — stays out of the browse list but remains readable by its owner.
--
-- The old two-argument signature is dropped: callers that send no cursor keep
-- working through the new defaults, and the only caller is the service-role
-- client behind the jobs page and /api/jobs/feed.

drop function if exists public.get_job_feed(uuid, integer);

create or replace function public.get_job_feed(
  p_viewer_id         uuid,
  p_limit             integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id         uuid default null
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select public.job_post_payload(p.job_id, p_viewer_id) as item
  from (
    select jp.id as job_id, jp.created_at
    from public.job_posts as jp
    where (public.job_post_is_open(jp.status, jp.closes_at)
           or jp.poster_id = p_viewer_id)
      and (p_before_created_at is null
           or (jp.created_at, jp.id) < (p_before_created_at, p_before_id))
    order by jp.created_at desc, jp.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) as p
  order by p.created_at desc, p.job_id desc;
$$;

revoke all on function public.get_job_feed(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.get_job_feed(uuid, integer, timestamptz, uuid) to service_role;
