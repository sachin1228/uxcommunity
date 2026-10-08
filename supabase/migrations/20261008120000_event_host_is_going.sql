-- ============================================================
-- The host is going to their own event
--
-- Creating an event puts its creator in the event's group chat
-- (ensureEventChatCommunity) — but until now it never wrote their RSVP, so the
-- creator's own card offered them the "I'm Going" button and the going count
-- (rsvp_count, computed from event_rsvps everywhere: the feed RPCs, the list
-- page RPC, the attendee strip) left them out. The host is the first person
-- who is going; the row belongs there from the moment the event exists.
--
-- Location app writers now write that row with the event (POST
-- /api/communities/[id]/events). This migration repairs the events that
-- predate that — one row per event whose creator has no RSVP yet.
--
-- Two deliberate choices:
--
--   * created_at is the EVENT's created_at, not now(). The attendee previews
--     and the going list order oldest RSVP first, and the host belongs at the
--     head of their own list — stamping the repair with now() would drop them
--     at the tail of every event they made.
--   * the guard is `not exists`: every event whose creator has no RSVP row
--     is repaired. A host who deliberately RSVPed and withdrew before this
--     migration is indistinguishable from one who never RSVPed — both leave
--     no row — so they are re-added once, with the rest; the card's withdraw
--     still works, and their group chat is untouched either way.
-- ============================================================

-- ─── Preview first: the events whose creator is not going ───
select e.id,
       e.title,
       e.user_id as host_id,
       e.created_at as event_created_at
  from public.community_events e
 where not exists (
         select 1
           from public.event_rsvps r
          where r.event_id = e.id
            and r.user_id = e.user_id
       );

do $$
declare
  affected integer;
begin
  select count(*) into affected
    from public.community_events e
   where not exists (
           select 1
             from public.event_rsvps r
            where r.event_id = e.id
              and r.user_id = e.user_id
         );

  raise notice 'event_host_is_going: % event(s) to backfill', affected;
end $$;

insert into public.event_rsvps (event_id, user_id, created_at)
select e.id, e.user_id, e.created_at
  from public.community_events e
 where not exists (
         select 1
           from public.event_rsvps r
          where r.event_id = e.id
            and r.user_id = e.user_id
       )
on conflict (event_id, user_id) do nothing;
