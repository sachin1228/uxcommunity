-- Accent color for the event ticket card. Chosen in the create/edit modal,
-- rendered as the ticket's main color (date number, going button, pill).
alter table public.community_events
  add column if not exists accent_color text;

comment on column public.community_events.accent_color is
  'Hex accent color for the event card theming; null means the default yellow.';
