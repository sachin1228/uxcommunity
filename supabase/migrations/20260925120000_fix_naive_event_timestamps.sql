-- ============================================================
-- Repair event timestamps stored before the zone-aware writer
--
-- The event create/edit form used to join its date and time inputs
-- into a zone-less string ("2026-09-25T12:10:00"). A timestamptz
-- column reads such a value in the session's timezone — UTC on this
-- deployment — so a member typing a wall time had it stored as that
-- same wall time in UTC, and every card then displayed it shifted by
-- their own zone's offset (a typed 12:10 showed as 17:40 IST).
--
-- What "repaired" means here: the stored value's UTC wall clock IS
-- the wall time the member typed (that is precisely what the bug
-- persisted), so the repair keeps those numbers and changes the zone
-- they are read in — "12:10 UTC" becomes "12:10 Asia/Kolkata". In
-- SQL, the double AT TIME ZONE does exactly that:
--
--   (event_date AT TIME ZONE 'UTC')          -- the wall clock typed
--                            AT TIME ZONE zone -- re-read in their zone
--
-- (A single AT TIME ZONE followed by a cast would round-trip to the
-- same instant and change nothing.)
--
-- Which rows: every event is created through that one form — there
-- is no other writer of these columns — so every row that predates
-- the fix was written by the broken writer, and every row written or
-- re-saved after it already carries an explicit zone. The guard is
-- therefore temporal, not structural: created_at and updated_at both
-- before the fix instant. Re-saved rows are skipped (their
-- updated_at moved past the fix), so nothing is shifted twice. Rows
-- re-saved in the narrow window between app fix and this migration
-- are left alone — deliberately: shifting an already-correct row
-- would be a second error, while leaving one means the member is one
-- edit away from the truth.
--
-- A structural hint is kept as defence in depth — extract(second …)
-- = 0, because the browser time input cannot emit seconds — so any
-- manually inserted row (now()-shaped, seconds present) is skipped.
--
-- The zone is the creator's quiet-hours timezone when the app has
-- one (the only per-user zone it stores — set on notification
-- settings), falling back to the deployment's own zone,
-- Asia/Kolkata. IST has no DST, so one offset applies to every
-- stored value; zones that do observe DST get the offset at each
-- timestamp's own date, which the AT TIME ZONE form handles by
-- construction — with one loud exception: a start/end pair straddling
-- a spring-forward transition can shift by different amounts and trip
-- the table's end_date > event_date check, aborting the migration for
-- that row rather than corrupting it. This deployment's fallback zone
-- has no transitions, so it cannot happen here.
-- ============================================================

-- The cutoff is the moment the zone-aware writer went live (dev hot
-- reload, 2026-09-25 12:36 IST; commit 5d19ed35). Every write before
-- it came from the broken code and every write after it carries an
-- explicit zone, so "updated before the cutoff" is exact for this
-- deployment. Adjust if you deploy elsewhere: bias the cutoff EARLY —
-- a cutoff too late would wrongly shift correct rows, while an early
-- one at worst misses rows that are one edit away from the truth.
-- ─── Preview first: what will move, under which zone ─────────
select e.id,
       e.title,
       e.event_date as stored_start,
       e.end_date   as stored_end,
       coalesce((select p.quiet_hours_timezone
                   from public.notification_preferences p
                  where p.user_id = e.user_id
                  limit 1), 'Asia/Kolkata')          as zone_used,
       ((e.event_date at time zone 'utc')
          at time zone coalesce((select p.quiet_hours_timezone
                                   from public.notification_preferences p
                                  where p.user_id = e.user_id
                                  limit 1), 'Asia/Kolkata')) as repaired_start
  from public.community_events e
 where e.created_at  < '2026-09-25T12:36:00+05:30'::timestamptz
   and e.updated_at  < '2026-09-25T12:36:00+05:30'::timestamptz
   and extract(second from e.event_date) = 0;

-- Report the count in the migration log, then repair.
do $$
declare
  affected integer;
begin
  select count(*) into affected
    from public.community_events e
   where e.created_at  < '2026-09-25T12:36:00+05:30'::timestamptz
     and e.updated_at  < '2026-09-25T12:36:00+05:30'::timestamptz
     and extract(second from e.event_date) = 0;

  raise notice 'fix_naive_event_timestamps: % row(s) to repair', affected;
end $$;

update public.community_events e
   set event_date = ((e.event_date at time zone 'utc')
                       at time zone coalesce((select p.quiet_hours_timezone
                                               from public.notification_preferences p
                                              where p.user_id = e.user_id
                                              limit 1), 'Asia/Kolkata')),
       end_date   = case
                      when e.end_date is null then null
                      else ((e.end_date at time zone 'utc')
                              at time zone coalesce((select p.quiet_hours_timezone
                                                      from public.notification_preferences p
                                                     where p.user_id = e.user_id
                                                     limit 1), 'Asia/Kolkata'))
                    end
 where e.created_at  < '2026-09-25T12:36:00+05:30'::timestamptz
   and e.updated_at  < '2026-09-25T12:36:00+05:30'::timestamptz
   and extract(second from e.event_date) = 0;
