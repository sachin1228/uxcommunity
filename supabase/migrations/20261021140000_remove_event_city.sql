-- ============================================================
-- Remove the city dimension from events.
--
-- The standalone city Events page is gone: mobile replaced that tab with
-- Explore, and web now redirects /dashboard/events to the feed. Event rooms,
-- cards, RSVPs and community Events tabs never used the city. So the read
-- path goes, every stored value is cleared, and the column is dropped.
--
-- Apply from the SQL editor BEFORE deploying the matching builds — both
-- clients stop sending city_id and the event card projection stops selecting
-- it.
-- ============================================================

-- ─── 1. The city page's read path ───────────────────────────
drop function if exists public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer, boolean, timestamptz, timestamptz);
drop function if exists public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer);

-- ─── 2. Old events lose their city ──────────────────────────
update public.community_events set city_id = null where city_id is not null;

drop index if exists public.idx_community_events_city_public_date;

alter table public.community_events drop column if exists city_id;
