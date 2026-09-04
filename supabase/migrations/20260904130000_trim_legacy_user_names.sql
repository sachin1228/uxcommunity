-- ============================================================
-- Trim padded whitespace from legacy user display names
--
-- Accounts created before the name/surname split store a single
-- combined `name` — and some carry stray leading/trailing
-- whitespace ("sachin   "). New signups are already stored clean
-- (atomic_signup_completion btrims p_name), but the legacy rows
-- kept their padding, and that raw value got baked into chat
-- @mention text, mention snapshots and notification rows at send
-- time.
--
-- The web client now trims names on the way in and out (so old
-- messages render with clean pills), but this one-time pass cleans
-- the source so every other reader — copy/search, moderation, the
-- mobile client — sees a tidy name too.
--
-- A name that is *only* whitespace becomes NULL so display code
-- that falls back to an email / "Member" label handles it instead
-- of showing a blank string.
-- ============================================================

update public.users
  set name = nullif(btrim(name), '')
  where name is not null
    and btrim(name) <> name;
