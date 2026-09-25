-- ============================================================
-- Event chat join questions
--
-- Joining an event's group chat (by RSVP-ing "I'm going", or
-- confirming from the room itself) asks the host's four
-- compulsory questions first:
--
--   * Company name
--   * Years of work experience
--   * Why do you want to attend this meetup?
--   * What are you expecting from this meetup?
--
-- The answers are recorded per member against the event's chat
-- community, and the host (owner / admin with "manage members")
-- reads them back per member in that room's Members tab.
-- ============================================================

create table if not exists event_chat_join_responses (
  community_id    uuid not null references communities (id) on delete cascade,
  user_id         uuid not null references users (id) on delete cascade,
  company_name    varchar(200) not null check (char_length(company_name) between 1 and 200),
  work_experience varchar(100) not null check (char_length(work_experience) between 1 and 100),
  why_attend      text not null check (char_length(why_attend) between 1 and 2000),
  expectations    text not null check (char_length(expectations) between 1 and 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists idx_event_chat_join_responses_community
  on event_chat_join_responses (community_id);

create or replace trigger trg_event_chat_join_responses_updated_at
  before update on event_chat_join_responses
  for each row execute function set_updated_at();

alter table event_chat_join_responses enable row level security;

-- The answers are personal, so the public API only ever hands a member their
-- own row. Hosts read everyone's through the server route, which checks the
-- manager role before touching the service client (which bypasses RLS).
create policy "author_read" on event_chat_join_responses
  for select using (auth.uid() = user_id);
