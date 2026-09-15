-- ============================================================
-- Showcase becomes a toggleable community area
--
-- Showcase used to be rendered unconditionally by the community header, so it
-- never appeared in enabled_tabs and could not be turned off. Making it an
-- owner-controlled area means it has to be a legal tab value, on by default so
-- new communities match today's behaviour, and backfilled onto existing rows so
-- no community silently loses the tab once the header stops hardcoding it.
-- ============================================================

alter table communities
  drop constraint if exists communities_enabled_tabs_check;

alter table communities
  alter column enabled_tabs set default array['chat', 'threads', 'showcase', 'events', 'resources'];

-- Backfill while the old constraint is still dropped — it does not admit
-- 'showcase', so this update would otherwise fail.
update communities
  set enabled_tabs = enabled_tabs || 'showcase'
  where not ('showcase' = any(enabled_tabs));

alter table communities
  add constraint communities_enabled_tabs_check
  check (
    enabled_tabs <@ array['chat', 'threads', 'showcase', 'events', 'resources']
    and 'chat' = any(enabled_tabs)
  );
