-- Enable Supabase Realtime for community_messages so postgres_changes
-- subscriptions fire when new messages are inserted.
alter publication supabase_realtime add table community_messages;
