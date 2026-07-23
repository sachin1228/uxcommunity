-- ============================================================
-- Soft-delete support for community_messages
--
-- Adds a deleted_at timestamp. When set, the message is
-- considered deleted for everyone. Content and image_url are
-- cleared server-side on delete so no text leaks via the DB.
--
-- The content/image constraint is relaxed to allow both to be
-- null when the message has been soft-deleted.
-- ============================================================

ALTER TABLE community_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Relax the content/image constraint to allow deleted rows
-- (where both content and image_url will be null).
ALTER TABLE community_messages
  DROP CONSTRAINT IF EXISTS community_messages_content_check;

ALTER TABLE community_messages
  ADD CONSTRAINT community_messages_content_check CHECK (
    deleted_at IS NOT NULL  -- soft-deleted rows bypass content requirement
    OR (content IS NOT NULL AND length(content) BETWEEN 1 AND 2000)
    OR image_url IS NOT NULL
  );

-- Ensure Supabase Realtime broadcasts UPDATE events for this table
-- so clients receive soft-delete notifications in real time.
-- (The publication already includes this table; this is a no-op safety guard.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE community_messages;
  END IF;
END $$;
