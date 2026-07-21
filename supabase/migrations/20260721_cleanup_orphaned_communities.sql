-- ============================================================
-- Clean up orphaned communities whose master data was deleted.
-- A community is "orphaned" when its reference_id no longer
-- exists in the corresponding master table.
-- Safe to re-run (deletes 0 rows if already clean).
-- ============================================================

-- Interest communities with no matching design_interest
delete from communities
where type = 'interest'
  and reference_id not in (select id from design_interests);

-- Sector communities with no matching design_sector
delete from communities
where type = 'sector'
  and reference_id not in (select id from design_sectors);

-- City communities with no matching city
delete from communities
where type = 'city'
  and reference_id not in (select id from cities);

-- Company communities with no matching company
delete from communities
where type = 'company'
  and reference_id not in (select id from companies);

-- Experience-level communities with no matching experience_level
delete from communities
where type = 'experience_level'
  and reference_id not in (select id from experience_levels);
