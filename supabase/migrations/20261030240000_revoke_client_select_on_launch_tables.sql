-- ============================================================
-- Revoke client-role SELECT on tables created after the public-read fix
--
-- 20260926000000_close_public_read_exposure.sql revoked every table that
-- existed at that point and documented the convention: a migration that
-- creates a table must revoke anon/authenticated itself, because Supabase's
-- project defaults grant both roles access to new tables.
--
-- Seven tables created after that sweep missed the revoke:
--   * content_reports / content_removals (Oct 5 report queue)
--   * member_resumes                  (Oct 10 saved résumés)
--   * fcm_tokens                      (Oct 23 push tokens)
--   * account_verification_requests  ┐
--   * verification_email_codes       ├ Oct 26 account verification
--   * verification_settings          ┘
--
-- All seven have RLS enabled and no client-facing policy, so today the grant
-- alone does not return rows — but it removes the second line of defence.
-- Adding one permissive policy later would reopen the Data API for that table.
-- The app reads and writes these tables only through the service-role client,
-- and apps/realtime never uses PostgREST, so the service role is untouched.
--
-- public_read_exposure.test.sql asserts this count is zero; this migration is
-- what brings those seven back to zero.
-- ============================================================

revoke all on table public.content_reports
  from public, anon, authenticated;
revoke all on table public.content_removals
  from public, anon, authenticated;
revoke all on table public.member_resumes
  from public, anon, authenticated;
revoke all on table public.fcm_tokens
  from public, anon, authenticated;
revoke all on table public.account_verification_requests
  from public, anon, authenticated;
revoke all on table public.verification_email_codes
  from public, anon, authenticated;
revoke all on table public.verification_settings
  from public, anon, authenticated;

comment on table public.content_reports is
  'User reports for posts; retained as moderation evidence after reporter deletion. Client roles have no access; reads/writes go through the service-role client.';
comment on table public.member_resumes is
  'Saved résumés. Private object keys; client roles have no access, downloads go through the authorization-gated proxy.';
comment on table public.fcm_tokens is
  'Android FCM device tokens for chat push. Client roles have no access.';
comment on table public.account_verification_requests is
  'Account verification submissions and private work-sample keys. Client roles have no access.';
