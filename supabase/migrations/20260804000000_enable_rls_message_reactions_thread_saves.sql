-- Enable Row-Level Security on tables that were missing it.
-- All writes go through the service-role key on the server;
-- RLS is enabled here so that the anon/public key cannot
-- read, insert, update, or delete rows directly.

alter table message_reactions enable row level security;
alter table thread_saves       enable row level security;
