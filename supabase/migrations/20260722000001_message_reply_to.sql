-- Add reply threading to community messages.
-- reply_to_id is nullable; SET NULL on delete so replies survive message deletion.

ALTER TABLE community_messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid
    REFERENCES community_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_messages_reply_to_id
  ON community_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;
