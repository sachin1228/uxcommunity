-- ============================================================
-- Preserve structured report evidence
--
-- content_reports kept only the title/author; interaction reports kept an
-- empty object for comments, chat messages and profiles. The policy promises a
-- snapshot that survives edits/deletion, so store the target fields at report
-- time. Additive only: existing reports keep their rows and empty snapshots.
-- ============================================================

alter table public.content_reports
  add column if not exists target_snapshot jsonb not null default '{}'::jsonb;

comment on column public.content_reports.target_snapshot is
  'Immutable copy of the reported post fields (title, body, media, links, created_at, author/community ids) captured when the report was filed.';

notify pgrst, 'reload schema';
