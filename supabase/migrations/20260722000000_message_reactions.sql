-- Message reactions: one reaction per user per message (toggle/replace UX).
-- community_id is denormalized here so Supabase Realtime can filter
-- reaction events by community without a join.

create table if not exists message_reactions (
  id           uuid        primary key default gen_random_uuid(),
  message_id   uuid        not null references community_messages(id) on delete cascade,
  community_id uuid        not null references communities(id)         on delete cascade,
  user_id      uuid        not null,
  emoji        text        not null check (char_length(emoji) <= 10),
  created_at   timestamptz not null default now(),
  -- one reaction per user per message
  unique (message_id, user_id)
);

create index if not exists idx_message_reactions_message_id
  on message_reactions (message_id);

create index if not exists idx_message_reactions_community_id
  on message_reactions (community_id);

-- Enable realtime for this table (run in Supabase dashboard too if needed)
-- alter publication supabase_realtime add table message_reactions;
