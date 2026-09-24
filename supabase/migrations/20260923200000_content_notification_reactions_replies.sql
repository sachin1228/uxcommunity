-- Reactions and replies on the chat timeline's permanent "created a …"
-- notification cards (threads / showcase posts / resources / events).
--
-- Reactions: content_reactions mirrors message_reactions but anchors to any
-- community content row (community_threads, community_showcase_posts,
-- community_resources, community_events) instead of a chat message. One
-- reaction per user per content item, toggle/replace UX. community_id is
-- denormalized for realtime filtering, exactly like message_reactions.
--
-- Replies: chat messages can now reference a content row via
-- reply_to_content_id (mutually exclusive with reply_to_id — a reply anchors
-- to either a message or a content item). The RPCs embed a reply_to preview
-- built from the content title so bubbles render identically for both.

-- ─── content_reactions ──────────────────────────────────────────────────────

create table if not exists content_reactions (
  id           uuid        primary key default gen_random_uuid(),
  content_id   uuid        not null,
  content_kind text        not null check (content_kind in ('thread', 'showcase', 'resource', 'event')),
  community_id uuid        not null references communities(id) on delete cascade,
  user_id      uuid        not null,
  emoji        text        not null check (char_length(emoji) <= 10),
  created_at   timestamptz not null default now(),
  -- one reaction per user per content item
  unique (content_id, content_kind, user_id)
);

create index if not exists idx_content_reactions_content
  on content_reactions (content_id, content_kind);

create index if not exists idx_content_reactions_community
  on content_reactions (community_id);

alter table content_reactions enable row level security;

drop policy if exists "public_read" on content_reactions;
create policy "public_read" on content_reactions
  for select using (true);

-- Writes stay server-side (service role bypasses RLS), mirroring
-- message_reactions where the API route owns the mutation.

-- ─── replies anchored to content items ──────────────────────────────────────

alter table community_messages
  add column if not exists reply_to_content_id uuid;

create index if not exists idx_community_messages_reply_to_content
  on community_messages (reply_to_content_id)
  where reply_to_content_id is not null;
