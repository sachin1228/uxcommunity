-- ============================================================
-- Deleting an event keeps its group chat
--
-- communities.event_id was created `on delete cascade` (see
-- 20260924130000_event_chat_communities): the room existed for the
-- event, so the event's death took the room — and everybody's
-- conversation in it — with it. That is not what the product wants.
-- The room is where the people who went keep talking after the event
-- is over, and a host tidying up a past event must not delete a
-- community out from under its members.
--
-- What a deleted event now takes is the link, and with it the two
-- things that read it: the calendar badge on the room's DP (LIVE /
-- ENDED / its date) and the Event card beside the room's chat (see
-- lib/communities/event-chat — both resolve the room's event through
-- this column and simply find none, which is how every other
-- community already reads). The room, its members and its messages
-- stay exactly as they were.
--
-- `on delete set null` is that link. The unique index on event_id
-- stays valid: it is partial, and nulls never collide.
--
-- The delete route also unlinks the room itself before removing the
-- event, so a deployment that has not applied this migration yet
-- still keeps the room — the cascade only fires on the event row, and
-- by then nothing points at it.
-- ============================================================

alter table public.communities
  drop constraint if exists communities_event_id_fkey;

alter table public.communities
  add constraint communities_event_id_fkey
  foreign key (event_id) references public.community_events (id) on delete set null;
