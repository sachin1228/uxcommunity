-- ============================================================
-- Migration: Replace design sectors with industry sectors,
--            and add seed data for companies and Indian cities.
--
-- Safe to run on a live DB:
--   • Sectors not referenced by any designer_profile are deleted.
--   • Sectors in use are kept (ON DELETE RESTRICT would block removal).
--   • New sectors/companies/cities are inserted with ON CONFLICT DO NOTHING.
--
-- NOTE on FK sync:
--   designer_profiles references cities, companies, and design_sectors
--   via UUID foreign keys (ON DELETE RESTRICT). Renaming a city/company/
--   sector is safe — the FK still points to the same row, so every profile
--   automatically reflects the new name with no extra updates needed.
-- ============================================================

-- ─── Remove old design-discipline sectors that are not in use ───
delete from design_sectors
where name in (
  'Product Design',
  'UI Design',
  'UX Design',
  'UX Research',
  'Interaction Design',
  'Visual Design',
  'Brand Design',
  'Graphic Design',
  'Motion Design',
  'Design Systems',
  'Service Design',
  'Industrial Design',
  'Accessibility',
  'Design Operations',
  'AI Design',
  'Other'
)
and id not in (
  select sector_id from designer_profiles where sector_id is not null
);

-- ─── Industry Sectors ───────────────────────────────────────
insert into design_sectors (name) values
  ('Healthcare & MedTech'),
  ('Finance & Fintech'),
  ('Industrial & Manufacturing'),
  ('Artificial Intelligence & ML'),
  ('E-commerce & Retail'),
  ('Education & EdTech'),
  ('Real Estate & PropTech'),
  ('Travel & Hospitality'),
  ('Media & Entertainment'),
  ('Food & Agritech'),
  ('Logistics & Supply Chain'),
  ('Automotive & Mobility'),
  ('Cybersecurity'),
  ('SaaS & Enterprise Software'),
  ('Government & Public Sector'),
  ('Gaming & Esports'),
  ('CleanTech & Sustainability'),
  ('Telecom & Networking'),
  ('Non-profit & Social Impact'),
  ('Other')
on conflict (name) do nothing;

-- ─── Companies ──────────────────────────────────────────────
insert into companies (name) values
  ('Google India'),
  ('Microsoft India'),
  ('Amazon India'),
  ('Apple India'),
  ('Meta India'),
  ('Flipkart'),
  ('Zomato'),
  ('Swiggy'),
  ('Paytm'),
  ('PhonePe'),
  ('Razorpay'),
  ('CRED'),
  ('Zepto'),
  ('Meesho'),
  ('Nykaa'),
  ('Myntra'),
  ('Urban Company'),
  ('Ola'),
  ('Rapido'),
  ('Groww'),
  ('Zerodha'),
  ('BYJU''S'),
  ('Unacademy'),
  ('upGrad'),
  ('Vedantu'),
  ('Infosys'),
  ('Wipro'),
  ('TCS'),
  ('HCL Technologies'),
  ('Tech Mahindra'),
  ('Accenture India'),
  ('IBM India'),
  ('Deloitte India'),
  ('PwC India'),
  ('McKinsey India'),
  ('ThoughtWorks'),
  ('Freshworks'),
  ('Zoho'),
  ('InMobi'),
  ('Browserstack')
on conflict (name) do nothing;

-- ─── Indian Cities ──────────────────────────────────────────
insert into cities (name) values
  ('Mumbai'),
  ('Delhi'),
  ('Bengaluru'),
  ('Hyderabad'),
  ('Chennai'),
  ('Pune'),
  ('Kolkata'),
  ('Ahmedabad'),
  ('Jaipur'),
  ('Surat'),
  ('Lucknow'),
  ('Kanpur'),
  ('Nagpur'),
  ('Indore'),
  ('Thane'),
  ('Bhopal'),
  ('Visakhapatnam'),
  ('Patna'),
  ('Vadodara'),
  ('Ludhiana'),
  ('Agra'),
  ('Nashik'),
  ('Faridabad'),
  ('Meerut'),
  ('Rajkot'),
  ('Aurangabad'),
  ('Amritsar'),
  ('Navi Mumbai'),
  ('Prayagraj'),
  ('Ranchi'),
  ('Howrah'),
  ('Coimbatore'),
  ('Jabalpur'),
  ('Gwalior'),
  ('Vijayawada'),
  ('Jodhpur'),
  ('Madurai'),
  ('Raipur'),
  ('Kota'),
  ('Guwahati'),
  ('Chandigarh'),
  ('Thiruvananthapuram'),
  ('Mysuru'),
  ('Noida'),
  ('Gurugram'),
  ('Srinagar'),
  ('Mangaluru'),
  ('Kochi'),
  ('Bhubaneswar'),
  ('Dehradun')
on conflict (name) do nothing;
