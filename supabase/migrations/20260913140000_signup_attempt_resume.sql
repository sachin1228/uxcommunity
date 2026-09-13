-- ============================================================
-- Resume links for incomplete signups
--
-- Admins can email a drop-off a link that takes them back into signup with
-- their name/email prefilled. The token is stored on the attempt row so the
-- link can be validated and expires on its own (mirrors invitation tokens).
--
-- Direct signups get a generated token; invitation drop-offs re-send their
-- original invitation instead, so the application linkage is preserved.
-- ============================================================

alter table public.signup_attempts
  add column if not exists resume_token text,
  add column if not exists resume_token_expires_at timestamptz,
  add column if not exists resume_email_sent_at timestamptz;

-- A partial index keeps the lookup fast while allowing many rows with no token.
create unique index if not exists idx_signup_attempts_resume_token
  on public.signup_attempts (resume_token)
  where resume_token is not null;
