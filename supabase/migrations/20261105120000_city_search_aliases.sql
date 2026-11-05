-- Cities are known by more than their catalog name: members type "Bangalore"
-- for Bengaluru, "Bombay" for Mumbai, "Gurgaon" for Gurugram, "Saigon" for
-- Ho Chi Minh City. Store those alternate names on the row so every city
-- dropdown (signup, profile, jobs) can match them.
--
-- Seed-only: rows that already carry aliases keep them, so re-running the
-- migration locally never clobbers later edits.
alter table public.cities
  add column if not exists aliases text[] not null default '{}';

update public.cities as c
set aliases = v.aliases
from (values
  ('Bengaluru',        array['Bangalore', 'Bengalooru', 'Bangaluru']),
  ('Mumbai',           array['Bombay']),
  ('Chennai',          array['Madras']),
  ('Kolkata',          array['Calcutta']),
  ('Delhi',            array['New Delhi', 'Dilli']),
  ('Gurugram',         array['Gurgaon']),
  ('Pune',             array['Poona']),
  ('Kochi',            array['Cochin']),
  ('Ahmedabad',        array['Amdavad']),
  ('Dhaka',            array['Dacca']),
  ('Kathmandu',        array['Katmandu']),

  ('Lisbon',           array['Lisboa']),
  ('Rome',             array['Roma']),
  ('Milan',            array['Milano']),
  ('Turin',            array['Torino']),
  ('Munich',           array['München']),
  ('Vienna',           array['Wien']),
  ('Prague',           array['Praha']),
  ('Warsaw',           array['Warszawa']),
  ('Bucharest',        array['Bucuresti']),
  ('Brussels',         array['Bruxelles']),
  ('Copenhagen',       array['Kobenhavn']),
  ('Kyiv',             array['Kiev']),
  ('Belgrade',         array['Beograd']),
  ('Athens',           array['Athina']),

  ('Beijing',          array['Peking']),
  ('Guangzhou',        array['Canton']),
  ('Ho Chi Minh City', array['Saigon', 'HCMC']),
  ('Hong Kong',        array['HK']),
  ('Kuala Lumpur',     array['KL']),
  ('Tel Aviv',         array['Tel Aviv-Yafo']),

  ('New York City',    array['New York', 'NYC']),
  ('Los Angeles',      array['LA']),
  ('San Francisco',    array['SF', 'San Fran', 'Frisco']),
  ('Washington DC',    array['Washington', 'DC']),
  ('Mexico City',      array['CDMX', 'Ciudad de Mexico', 'Mexico DF']),
  ('Rio de Janeiro',   array['Rio']),
  ('Philadelphia',     array['Philly']),

  ('Johannesburg',     array['Joburg', 'Jozi']),
  ('Jeddah',           array['Jiddah'])
) as v(name, aliases)
where c.name = v.name
  and coalesce(c.aliases, '{}') = '{}';
