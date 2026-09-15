-- ============================================================
-- Showcase becomes a toggleable community area
--
-- Showcase used to be rendered unconditionally by the community header, so it
-- never appeared in enabled_tabs and could not be turned off. It is now a legal
-- tab value and part of the column default.
--
-- Only private communities get to choose it (public communities always show the
-- tab in code), so the backfill below is what keeps Showcase on existing
-- communities: every row created before this feature has an array without it,
-- and a private community with no record of it would lose the tab.
-- ============================================================

alter table communities
  drop constraint if exists communities_enabled_tabs_check;

alter table communities
  alter column enabled_tabs set default array['chat', 'threads', 'showcase', 'events', 'resources'];

-- Backfill while the old constraint is still dropped — it does not admit
-- 'showcase', so this update would otherwise fail. Public rows are included for
-- consistency: the tab is unconditional for them, so recording it is honest.
update communities
  set enabled_tabs = enabled_tabs || 'showcase'
  where not ('showcase' = any(enabled_tabs));

alter table communities
  add constraint communities_enabled_tabs_check
  check (
    enabled_tabs <@ array['chat', 'threads', 'showcase', 'events', 'resources']
    and 'chat' = any(enabled_tabs)
  );
