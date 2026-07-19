-- Index for the incremental message fetch query used by the communities chat.
--
-- The ?after=ISO endpoint runs:
--   SELECT ... FROM community_messages
--   WHERE community_id = $1 AND created_at > $2
--   ORDER BY created_at DESC
--
-- Without this index Postgres does a sequential scan of all messages for a
-- community, which becomes slow as the table grows.
--
-- The full-fetch (no ?after) endpoint also benefits:
--   SELECT ... FROM community_messages
--   WHERE community_id = $1
--   ORDER BY created_at DESC
--   LIMIT 50
--
-- Run this migration once in Supabase SQL editor or via the Supabase CLI:
--   supabase db push

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_messages_community_created
  ON community_messages (community_id, created_at DESC);
