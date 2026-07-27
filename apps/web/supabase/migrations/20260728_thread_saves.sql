-- Thread saves (bookmarks): one row per user per thread
CREATE TABLE IF NOT EXISTS thread_saves (
  thread_id uuid NOT NULL REFERENCES community_threads(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS thread_saves_user_id_idx   ON thread_saves(user_id);
CREATE INDEX IF NOT EXISTS thread_saves_thread_id_idx ON thread_saves(thread_id);
