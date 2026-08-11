-- Fix: message reactions do not appear in the sidebar in real time
-- (they only show up after a full page refresh).
--
-- Root cause:
--   * message_reactions is in the supabase_realtime publication
--     (20260723000001_message_reactions_realtime.sql), so change events
--     are produced.
--   * RLS was later ENABLED on message_reactions
--     (20260804000000_enable_rls_message_reactions_thread_saves.sql) but
--     NO select policy was added.
--   * Supabase Realtime `postgres_changes` enforces RLS as the subscribing
--     role. The browser uses the anon key, and with RLS on + no SELECT
--     policy the anon role can read nothing, so the realtime server never
--     broadcasts reaction INSERT/UPDATE/DELETE events to clients.
--
-- A full refresh works because the server reads reactions through the
-- service-role key, which bypasses RLS.
--
-- Fix: mirror the community_messages pattern — allow public SELECT so the
-- anon realtime role can read reaction rows. All writes still go through
-- the Next.js API routes using the service-role key, never client-direct.

drop policy if exists "public_read" on message_reactions;

create policy "public_read" on message_reactions
  for select using (true);
