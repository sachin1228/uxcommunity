-- Fix: reactions not appearing in real-time for other users.
--
-- Two root causes:
--   1. message_reactions was never added to the supabase_realtime publication
--      (the ALTER PUBLICATION line in the original migration was commented out).
--   2. Without REPLICA IDENTITY FULL, DELETE events only carry the primary key
--      (id), so the client-side handler could not identify which message/user/emoji
--      to remove.
--
-- This migration fixes both.

-- 1. Full row in DELETE payloads (required for the realtime DELETE handler)
alter table message_reactions replica identity full;

-- 2. Broadcast changes to subscribed clients
alter publication supabase_realtime add table message_reactions;
