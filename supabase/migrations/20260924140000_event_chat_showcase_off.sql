-- ============================================================
-- Event group chats start without Showcase
--
-- Showcase keeps its own flag (communities.showcase_enabled) because
-- it predates enabled_tabs, and that flag defaults to ON. New event
-- rooms therefore have to write it off explicitly — which
-- lib/communities/event-chat now does when it creates one — otherwise
-- every fresh room offers a portfolio tab it has no use for.
--
-- This corrects the rooms that were created before that: the rooms
-- from 20260924130000_event_chat_communities.sql (including its
-- backfill) carry the default-on value. It is a one-time data fix, not
-- a rule about the type: Showcase stays a normal per-community
-- setting, so an owner can switch it back on from the room's settings
-- whenever they want it. The tab bar reads the flag, nothing else.
--
-- Guarded on the column existing, and idempotent — an environment
-- without the showcase-toggle migration has nothing to correct.
-- ============================================================

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'communities'
       and column_name = 'showcase_enabled'
  ) then
    update public.communities
       set showcase_enabled = false
     where type = 'event'
       and showcase_enabled is distinct from false;
  end if;
end $$;
