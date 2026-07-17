-- ============================================================
-- drafthub — seed data
-- Run after schema.sql to populate master-data tables.
-- ============================================================

-- ─── Design Sectors ─────────────────────────────────────────
insert into design_sectors (name) values
  ('Product Design'),
  ('UI Design'),
  ('UX Design'),
  ('UX Research'),
  ('Interaction Design'),
  ('Visual Design'),
  ('Brand Design'),
  ('Graphic Design'),
  ('Motion Design'),
  ('Design Systems'),
  ('Service Design'),
  ('Industrial Design'),
  ('Accessibility'),
  ('Design Operations'),
  ('AI Design'),
  ('Other')
on conflict (name) do nothing;

-- ─── Tags ───────────────────────────────────────────────────
insert into tags (name) values
  ('Top Talent'),
  ('Strong Portfolio'),
  ('UI Expert'),
  ('UX Expert'),
  ('Product Designer'),
  ('Design Systems'),
  ('Motion'),
  ('Junior'),
  ('Mid-Level'),
  ('Senior'),
  ('Needs Review'),
  ('High Priority'),
  ('Referral')
on conflict (name) do nothing;
