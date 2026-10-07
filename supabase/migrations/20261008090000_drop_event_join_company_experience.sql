-- ============================================================
-- Event chat join answers: drop company name + work experience
--
-- The host's compulsory join questions are down to two — why
-- attend, and what you're expecting (see
-- apps/web/lib/communities/event-join-questions.ts). The two
-- columns that held the dropped questions' answers, and
-- whatever members had stored in them, go with them: the
-- live columns on event_chat_join_responses are exactly the
-- two questions the form still asks.
--
-- Idempotent: safe to re-run.
-- ============================================================

alter table event_chat_join_responses
  drop column if exists company_name,
  drop column if exists work_experience;
