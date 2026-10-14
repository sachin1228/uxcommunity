-- Community chat keeps a 15-day window: the scheduled sweep
-- (apps/web/lib/communities/message-retention-sweep.ts, driven by the realtime
-- Worker's cron) hard-deletes messages older than the cutoff and removes their
-- R2 images. The sweep selects the oldest rows ACROSS all communities by
-- created_at, which no existing index serves — idx_community_messages_room_time
-- is (community_id, created_at), so a global cutoff scan would read every row
-- of every room. This index makes the per-batch "oldest first" read a range
-- scan that stops at the batch size.
create index if not exists idx_community_messages_created_at
  on community_messages (created_at);
