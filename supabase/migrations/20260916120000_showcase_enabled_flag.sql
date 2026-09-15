-- ============================================================
-- Showcase becomes a configurable community area
--
-- Showcase shipped as an unconditional tab in the community header, so it never
-- appeared in enabled_tabs — and every community created before this feature has
-- an enabled_tabs value without it. It therefore keeps its own flag instead of
-- joining that array, whose check constraint only admits the tab vocabulary the
-- APIs already validate.
--
-- The default of true is what makes this safe for communities that already
-- exist: their rows read as "on", so nobody loses the tab, and `false` is only
-- ever the explicit opt-out written from community settings.
-- ============================================================

alter table communities
  add column if not exists showcase_enabled boolean not null default true;
