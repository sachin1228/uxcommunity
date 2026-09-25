-- ============================================================
-- Remember the host's own zone for an event
-- ============================================================
--
-- An event is stored as an instant and every surface renders it on the
-- viewer's clock. That conversion is right, but on its own it loses the wall
-- time the host actually typed: a 3 PM booking made in New York reads as half
-- past midnight to a member in India, and the card has no way to say the two
-- are the same moment, or that 3 PM was what the host meant.
--
-- These two columns keep the host's side of it:
--   host_timezone           the IANA zone the host set it in ("America/New_York"),
--                           used to re-derive their wall clock on any viewer's
--                           browser and to name the zone ("EDT · UTC-4:00");
--   host_utc_offset_minutes the host's offset at the event's instant, in minutes
--                           east of UTC (IST is 330, EDT is -240) — the fallback
--                           when a browser cannot resolve the stored zone name.
--
-- Both are nullable on purpose: every event created before this has no host
-- zone, and the UI simply omits its host line for those rows rather than
-- guessing one.

alter table public.community_events
  add column if not exists host_timezone text,
  add column if not exists host_utc_offset_minutes integer;

alter table public.community_events
  drop constraint if exists community_events_host_timezone_len,
  drop constraint if exists community_events_host_utc_offset_range;

alter table public.community_events
  add constraint community_events_host_timezone_len
    check (host_timezone is null or char_length(host_timezone) between 1 and 64),
  add constraint community_events_host_utc_offset_range
    check (host_utc_offset_minutes is null or host_utc_offset_minutes between -840 and 840);
